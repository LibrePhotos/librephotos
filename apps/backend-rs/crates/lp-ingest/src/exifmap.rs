//! `PhotoMetadata.extract_exif_data`: which tags are read and how each value
//! lands on `api_photo` / `api_photometadata` (`_apply_to_photo`,
//! `_apply_to_metadata`), including the Python type checks.

use std::collections::HashMap;

use serde_json::Value;

use crate::pyfmt;

/// `EXIF_TAGS`, in `EXIF_VALUE_NAMES` order.
pub const EXIF_TAGS: [&str; 20] = [
    "File:FileSize",
    "EXIF:FNumber",
    "EXIF:FocalLength",
    "EXIF:ISO",
    "EXIF:ExposureTime",
    "EXIF:Model",
    "EXIF:LensModel",
    "ImageWidth",
    "ImageHeight",
    "EXIF:FocalLengthIn35mmFormat",
    "EXIF:SubjectDistance",
    "EXIF:DigitalZoomRatio",
    "QuickTime:Duration",
    "Rating",
    "EXIF:SubSecTimeOriginal",
    "EXIF:ImageNumber",
    "XMP:Subject",
    "IPTC:Keywords",
    "XMP:Description",
    "XMP:Description-*",
];

/// Values as `get_metadata` returned them, by tag.
pub struct Values<'a>(pub &'a HashMap<String, Option<Value>>);

impl Values<'_> {
    fn get(&self, tag: &str) -> Option<&Value> {
        self.0.get(tag).and_then(|v| v.as_ref())
    }
}

/// `_assign_nonzero_number`: a truthy number.
fn nonzero_number(v: Option<&Value>) -> Option<&Value> {
    v.filter(|v| pyfmt::is_number(v) && pyfmt::truthy(v))
}

/// `_assign_number`: any number (0 too).
fn number(v: Option<&Value>) -> Option<&Value> {
    v.filter(|v| pyfmt::is_number(v))
}

/// `_assign_string`: a non-empty string.
fn string(v: Option<&Value>) -> Option<String> {
    match v {
        Some(Value::String(s)) if !s.is_empty() => Some(s.clone()),
        _ => None,
    }
}

/// `_text_value`.
fn text_value(v: Option<&Value>) -> Option<String> {
    let s = match v? {
        Value::Bool(_) => return None,
        Value::Number(_) => pyfmt::value_str(v?),
        Value::String(s) => s.clone(),
        _ => return None,
    };
    let t = s.trim();
    if t.is_empty() {
        None
    } else {
        Some(t.to_string())
    }
}

/// Updates for `api_photo` (None = leave the column alone).
#[derive(Debug, Default, Clone)]
pub struct PhotoUpdate {
    pub size: Option<i64>,
    pub video_length: Option<String>,
    pub rating: Option<i64>,
    pub exif_timestamp_subsec: Option<String>,
    pub image_sequence_number: Option<i64>,
}

/// Updates for `api_photometadata`.
#[derive(Debug, Default, Clone)]
pub struct MetadataUpdate {
    pub aperture: Option<f64>,
    pub focal_length: Option<f64>,
    pub iso: Option<i64>,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub focal_length_35mm: Option<i64>,
    pub camera_model: Option<String>,
    pub lens_model: Option<String>,
    pub rating: Option<i64>,
    pub shutter_speed: Option<String>,
    pub date_taken_subsec: Option<String>,
    pub keywords: Option<Vec<String>>,
    /// The file's description (applied unless the user edited the caption).
    pub description: Option<String>,
}

fn truncate_chars(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

pub fn photo_update(v: &Values<'_>) -> PhotoUpdate {
    let subsec = v
        .get("EXIF:SubSecTimeOriginal")
        .filter(|x| pyfmt::truthy(x));
    PhotoUpdate {
        size: nonzero_number(v.get("File:FileSize")).and_then(pyfmt::as_int),
        video_length: nonzero_number(v.get("QuickTime:Duration")).map(pyfmt::value_str),
        rating: number(v.get("Rating")).and_then(pyfmt::as_int),
        exif_timestamp_subsec: subsec.map(|x| truncate_chars(&pyfmt::value_str(x), 10)),
        image_sequence_number: number(v.get("EXIF:ImageNumber")).and_then(pyfmt::as_int),
    }
}

/// `_merge_keywords`: XMP:Subject + IPTC:Keywords, deduplicated, sorted.
fn merge_keywords(values: &[Option<&Value>]) -> Vec<String> {
    let mut set = std::collections::BTreeSet::new();
    for v in values.iter().flatten() {
        match v {
            Value::Array(items) => {
                for i in items {
                    match i {
                        Value::String(s) => {
                            set.insert(s.clone());
                        }
                        other => {
                            set.insert(pyfmt::value_str(other));
                        }
                    }
                }
            }
            Value::String(s) if !s.is_empty() => {
                set.insert(s.clone());
            }
            _ => {}
        }
    }
    set.into_iter().collect()
}

pub fn metadata_update(v: &Values<'_>) -> MetadataUpdate {
    let f = |tag: &str| nonzero_number(v.get(tag)).and_then(pyfmt::as_float);
    let i = |tag: &str| nonzero_number(v.get(tag)).and_then(pyfmt::as_int);
    let shutter = v
        .get("EXIF:ExposureTime")
        .filter(|x| pyfmt::is_number(x) && pyfmt::truthy(x))
        .and_then(|x| pyfmt::fraction_limited(x, 1000));
    let subsec = v
        .get("EXIF:SubSecTimeOriginal")
        .filter(|x| pyfmt::truthy(x));
    let keywords = merge_keywords(&[v.get("XMP:Subject"), v.get("IPTC:Keywords")]);
    MetadataUpdate {
        aperture: f("EXIF:FNumber"),
        focal_length: f("EXIF:FocalLength"),
        iso: i("EXIF:ISO"),
        width: i("ImageWidth"),
        height: i("ImageHeight"),
        focal_length_35mm: i("EXIF:FocalLengthIn35mmFormat"),
        camera_model: string(v.get("EXIF:Model")),
        lens_model: string(v.get("EXIF:LensModel")),
        rating: number(v.get("Rating")).and_then(pyfmt::as_int),
        shutter_speed: shutter,
        date_taken_subsec: subsec.map(|x| truncate_chars(&pyfmt::value_str(x), 10)),
        keywords: if keywords.is_empty() {
            None
        } else {
            Some(keywords)
        },
        description: description(v),
    }
}

/// `_description`: x-default first, else any language entry.
pub fn description(v: &Values<'_>) -> Option<String> {
    text_value(v.get("XMP:Description")).or_else(|| text_value(v.get("XMP:Description-*")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn mapping() {
        let mut m = HashMap::new();
        m.insert("File:FileSize".to_string(), Some(json!(659)));
        m.insert("QuickTime:Duration".to_string(), Some(json!(2)));
        m.insert("Rating".to_string(), Some(json!(0)));
        m.insert("EXIF:ExposureTime".to_string(), Some(json!(0.004)));
        m.insert("EXIF:SubSecTimeOriginal".to_string(), Some(json!("50")));
        m.insert(
            "XMP:Subject".to_string(),
            Some(json!(["sidecar-keyword", "Fixture"])),
        );
        m.insert("IPTC:Keywords".to_string(), Some(json!("Fixture")));
        m.insert("XMP:Description-*".to_string(), Some(json!(" hi ")));
        m.insert("ImageWidth".to_string(), Some(json!(800)));
        let v = Values(&m);
        let p = photo_update(&v);
        assert_eq!(p.size, Some(659));
        assert_eq!(p.video_length.as_deref(), Some("2"));
        assert_eq!(p.rating, Some(0));
        assert_eq!(p.exif_timestamp_subsec.as_deref(), Some("50"));
        let md = metadata_update(&v);
        assert_eq!(md.shutter_speed.as_deref(), Some("1/250"));
        assert_eq!(md.width, Some(800));
        assert_eq!(md.keywords.unwrap(), vec!["Fixture", "sidecar-keyword"]);
        assert_eq!(md.description.as_deref(), Some("hi"));
        assert_eq!(md.rating, Some(0));
    }
}
