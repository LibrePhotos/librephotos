//! Face regions written by other tools (MWG `XMP:RegionInfo`), as
//! `face_extractor.extract_from_exif` reads them.

use std::path::Path;

use serde_json::Value;

use crate::exif::{self, MetadataError};
use lp_sidecars::FaceBox;

/// `get_metadata(path, [XMP:RegionInfo, EXIF:Orientation], try_sidecar=True,
/// struct=True)`: `(region_info, orientation)`, `None` without ExifTool.
pub async fn read_region_info(
    exiftool: &Path,
    media: &str,
) -> Result<Option<(Option<Value>, Option<Value>)>, MetadataError> {
    let Some(mut values) = exif::get_tags(
        exiftool,
        media,
        &["XMP:RegionInfo", "EXIF:Orientation"],
        true,
    )
    .await?
    else {
        return Ok(None);
    };
    let orientation = values.pop().flatten();
    let region = values.pop().flatten();
    Ok(Some((region, orientation)))
}

fn as_number(v: Option<&Value>) -> Option<f64> {
    match v? {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.trim().parse::<f64>().ok(),
        Value::Bool(b) => Some(if *b { 1.0 } else { 0.0 }),
        _ => None,
    }
}

/// `has_normalized_area`.
fn has_normalized_area(area: Option<&Value>, applied: Option<&Value>) -> bool {
    fn unit(v: Option<&Value>) -> Option<&str> {
        v.and_then(|v| v.get("Unit")).and_then(Value::as_str)
    }
    let area_truthy = area.is_some_and(|a| a.as_object().is_some_and(|o| !o.is_empty()));
    let applied_truthy = applied.is_some_and(|a| a.as_object().is_some_and(|o| !o.is_empty()));
    (area_truthy && unit(area) == Some("normalized"))
        || (applied_truthy && unit(applied) == Some("pixel"))
}

/// `to_face_box`: normalized centre/size to `(top, right, bottom, left)`,
/// after undoing the orientation, truncated like Python's `int()`.
pub fn to_face_box(
    area: &Value,
    orientation: Option<&str>,
    width: u32,
    height: u32,
) -> Option<FaceBox> {
    let x = as_number(area.get("X"))?;
    let y = as_number(area.get("Y"))?;
    let w = as_number(area.get("W"))?;
    let h = as_number(area.get("H"))?;
    let (x, y, w, h) = match orientation {
        Some("Rotate 90 CW") => (1.0 - y, x, h, w),
        Some("Mirror horizontal") => (1.0 - x, y, w, h),
        Some("Rotate 180") => (1.0 - x, 1.0 - y, w, h),
        Some("Mirror vertical") => (x, 1.0 - y, w, h),
        Some("Mirror horizontal and rotate 270 CW") => (1.0 - y, x, h, w),
        Some("Mirror horizontal and rotate 90 CW") => (y, 1.0 - x, h, w),
        Some("Rotate 270 CW") => (y, 1.0 - x, h, w),
        _ => (x, y, w, h),
    };
    let (iw, ih) = (width as f64, height as f64);
    let half_w = (w * iw) / 2.0;
    let half_h = (h * ih) / 2.0;
    let t = |v: f64| v.trunc() as i32;
    Some([
        t((y * ih) - half_h),
        t((x * iw) + half_w),
        t((y * ih) + half_h),
        t((x * iw) - half_w),
    ])
}

/// A face region from the file: its box and the name the tool gave it.
#[derive(Debug, Clone, PartialEq)]
pub struct RegionFace {
    pub location: FaceBox,
    pub name: Option<String>,
}

/// `extract_from_exif` minus the read: the `Type == "Face"` regions with a
/// usable area, boxed on a `width` x `height` big thumbnail.
pub fn faces_from_region_info(
    region_info: &Value,
    orientation: Option<&Value>,
    width: u32,
    height: u32,
) -> Vec<RegionFace> {
    let orientation = orientation.and_then(Value::as_str);
    let Some(list) = region_info.get("RegionList").and_then(Value::as_array) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for region in list {
        if region.get("Type").and_then(Value::as_str) != Some("Face") {
            continue;
        }
        let area = region.get("Area");
        if !has_normalized_area(area, region.get("AppliedToDimensions")) {
            continue;
        }
        let Some(location) = area.and_then(|a| to_face_box(a, orientation, width, height)) else {
            tracing::info!("broken face area exif data: no numerical positional data");
            continue;
        };
        let name = match region.get("Name") {
            Some(Value::String(s)) => Some(s.clone()),
            Some(Value::Number(n)) => Some(n.to_string()),
            _ => None,
        };
        out.push(RegionFace { location, name });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn boxes_follow_face_extractor() {
        let area = json!({"X": 0.5, "Y": 0.25, "W": 0.2, "H": 0.1, "Unit": "normalized"});
        assert_eq!(
            to_face_box(&area, None, 1000, 800),
            Some([160, 600, 240, 400])
        );
        assert_eq!(
            to_face_box(&area, Some("Rotate 90 CW"), 1000, 800),
            Some([320, 800, 480, 700])
        );
        let info = json!({"RegionList": [
            {"Type": "Face", "Name": "Anna", "Area": area},
            {"Type": "Pet", "Area": area},
            {"Type": "Face", "Area": {"X": "a", "Y": 1, "W": 1, "H": 1, "Unit": "normalized"}},
            {"Type": "Face", "Area": {"X": 0.1, "Y": 0.1, "W": 0.1, "H": 0.1, "Unit": "pixel"}}
        ]});
        let faces = faces_from_region_info(&info, None, 1000, 800);
        assert_eq!(faces.len(), 1);
        assert_eq!(faces[0].name.as_deref(), Some("Anna"));
    }
}
