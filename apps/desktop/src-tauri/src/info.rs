use std::path::Path;

use exif::{Exif, In, Tag, Value};
use serde::Serialize;

use crate::formats::{FileKind, ext_of, format_name, is_jpeg, kind_of_ext};
use crate::jpegmeta;
use crate::listing::modified_ms;
use crate::orient;
use crate::xmp;

const CAMERA_PLACEHOLDER_CAPTIONS: [&str; 7] = [
    "olympus digital camera",
    "sony dsc",
    "digital camera",
    "minolta digital camera",
    "konica minolta digital camera",
    "samsung camera pictures",
    "exif_jpeg_picture",
];

fn real_caption(text: String) -> Option<String> {
    let folded = text
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase();
    (!folded.is_empty() && !CAMERA_PLACEHOLDER_CAPTIONS.contains(&folded.as_str())).then_some(text)
}

#[derive(Serialize, Debug, Clone, Copy, PartialEq)]
pub struct Gps {
    pub lat: f64,
    pub lon: f64,
}

#[derive(Serialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ImageInfo {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub modified_ms: i64,
    pub format: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub taken_at: Option<String>,
    pub camera_make: Option<String>,
    pub camera_model: Option<String>,
    pub lens: Option<String>,
    pub exposure: Option<String>,
    pub f_number: Option<String>,
    pub iso: Option<u32>,
    pub focal_length: Option<String>,
    pub gps: Option<Gps>,
    pub extra: Vec<(String, String)>,
    pub rating: Option<u8>,
    pub caption: Option<String>,
    pub keywords: Vec<String>,
    pub sidecar: Option<String>,
    pub writable_in_file: bool,
}

pub fn fmt_exposure(t: f64) -> Option<String> {
    if !(t.is_finite() && t > 0.0) {
        return None;
    }
    if t < 0.3 {
        return Some(format!("1/{} s", (1.0 / t).round() as u64));
    }
    Some(format!("{} s", trim_num(t, 1)))
}

pub fn fmt_f_number(f: f64) -> Option<String> {
    (f.is_finite() && f > 0.0).then(|| format!("f/{}", trim_num(f, 1)))
}

pub fn fmt_focal(mm: f64) -> Option<String> {
    (mm.is_finite() && mm > 0.0).then(|| format!("{} mm", trim_num(mm, 1)))
}

pub fn fmt_flash(v: u32) -> String {
    if v & 0x20 != 0 {
        return "No flash".into();
    }
    let fired = v & 1 != 0;
    let mode = (v >> 3) & 3;
    let mut s = match (fired, mode) {
        (true, 1) => "Fired (forced)",
        (true, 3) => "Fired (auto)",
        (true, _) => "Fired",
        (false, 2) => "Off",
        (false, 3) => "Did not fire (auto)",
        (false, _) => "Did not fire",
    }
    .to_string();
    if v & 0x40 != 0 {
        s.push_str(", red-eye reduction");
    }
    s
}

fn trim_num(v: f64, decimals: usize) -> String {
    let s = format!("{v:.decimals$}");
    if s.contains('.') {
        s.trim_end_matches('0').trim_end_matches('.').to_string()
    } else {
        s
    }
}

pub fn exif_datetime_to_iso(s: &str) -> Option<String> {
    let s = s.trim().trim_end_matches('\0');
    let b = s.as_bytes();
    if b.len() < 19 || b[4] != b':' || b[7] != b':' || !(b[10] == b' ' || b[10] == b'T') {
        return None;
    }
    let (date, time) = (&s[..10], &s[11..19]);
    if !date.bytes().enumerate().all(|(i, c)| {
        if i == 4 || i == 7 {
            c == b':'
        } else {
            c.is_ascii_digit()
        }
    }) || date.starts_with("0000")
    {
        return None;
    }
    Some(format!("{}T{time}", date.replace(':', "-")))
}

fn ascii(exif: &Exif, tag: Tag) -> Option<String> {
    let f = exif.get_field(tag, In::PRIMARY)?;
    match &f.value {
        Value::Ascii(v) => {
            let s = v
                .iter()
                .map(|x| String::from_utf8_lossy(x).into_owned())
                .collect::<Vec<_>>()
                .join(" ");
            let s = s
                .trim_matches(|c: char| c == '\0' || c.is_whitespace())
                .to_string();
            (!s.is_empty()).then_some(s)
        }
        _ => None,
    }
}

fn rational(exif: &Exif, tag: Tag) -> Option<f64> {
    let f = exif.get_field(tag, In::PRIMARY)?;
    match &f.value {
        Value::Rational(v) => v.first().map(|r| r.to_f64()),
        Value::SRational(v) => v.first().map(|r| r.to_f64()),
        _ => f.value.get_uint(0).map(f64::from),
    }
}

fn shown(exif: &Exif, tag: Tag) -> Option<String> {
    let f = exif.get_field(tag, In::PRIMARY)?;
    let s = f.display_value().with_unit(exif).to_string();
    let s = s.trim_matches('"').trim().to_string();
    (!s.is_empty() && s != "unknown").then_some(s)
}

fn gps_coord(exif: &Exif, tag: Tag, ref_tag: Tag, neg: &str) -> Option<f64> {
    let f = exif.get_field(tag, In::PRIMARY)?;
    let Value::Rational(v) = &f.value else {
        return None;
    };
    let deg = v.first()?.to_f64()
        + v.get(1).map_or(0.0, |r| r.to_f64()) / 60.0
        + v.get(2).map_or(0.0, |r| r.to_f64()) / 3600.0;
    let sign = if ascii(exif, ref_tag).is_some_and(|r| r.eq_ignore_ascii_case(neg)) {
        -1.0
    } else {
        1.0
    };
    deg.is_finite().then_some(sign * deg)
}

fn fill_from_exif(info: &mut ImageInfo, exif: &Exif) {
    info.taken_at = info.taken_at.take().or_else(|| {
        ascii(exif, Tag::DateTimeOriginal)
            .or_else(|| ascii(exif, Tag::DateTime))
            .and_then(|s| exif_datetime_to_iso(&s))
    });
    info.camera_make = info.camera_make.take().or_else(|| ascii(exif, Tag::Make));
    info.camera_model = info.camera_model.take().or_else(|| ascii(exif, Tag::Model));
    info.lens = info.lens.take().or_else(|| ascii(exif, Tag::LensModel));
    info.exposure = info
        .exposure
        .take()
        .or_else(|| rational(exif, Tag::ExposureTime).and_then(fmt_exposure));
    info.f_number = info
        .f_number
        .take()
        .or_else(|| rational(exif, Tag::FNumber).and_then(fmt_f_number));
    info.iso = info.iso.or_else(|| {
        exif.get_field(Tag::PhotographicSensitivity, In::PRIMARY)
            .and_then(|f| f.value.get_uint(0))
    });
    info.focal_length = info
        .focal_length
        .take()
        .or_else(|| rational(exif, Tag::FocalLength).and_then(fmt_focal));
    if info.gps.is_none()
        && let (Some(lat), Some(lon)) = (
            gps_coord(exif, Tag::GPSLatitude, Tag::GPSLatitudeRef, "S"),
            gps_coord(exif, Tag::GPSLongitude, Tag::GPSLongitudeRef, "W"),
        )
        && !(lat == 0.0 && lon == 0.0)
    {
        info.gps = Some(Gps { lat, lon });
    }
    let mut add = |label: &str, v: Option<String>| {
        if let Some(v) = v
            && !info.extra.iter().any(|(l, _)| l == label)
        {
            info.extra.push((label.to_string(), v));
        }
    };
    add(
        "35 mm equivalent",
        exif.get_field(Tag::FocalLengthIn35mmFilm, In::PRIMARY)
            .and_then(|f| f.value.get_uint(0))
            .filter(|&v| v > 0)
            .map(|v| format!("{v} mm")),
    );
    add(
        "Exposure bias",
        rational(exif, Tag::ExposureBiasValue).map(|v| format!("{} EV", trim_num(v, 1))),
    );
    add("Exposure program", shown(exif, Tag::ExposureProgram));
    add("Metering", shown(exif, Tag::MeteringMode));
    add(
        "Flash",
        exif.get_field(Tag::Flash, In::PRIMARY)
            .and_then(|f| f.value.get_uint(0))
            .map(fmt_flash),
    );
    add("White balance", shown(exif, Tag::WhiteBalance));
    add("Color space", shown(exif, Tag::ColorSpace));
    add(
        "Altitude",
        rational(exif, Tag::GPSAltitude).map(|v| format!("{} m", trim_num(v, 0))),
    );
    add("Software", ascii(exif, Tag::Software));
    add("Artist", ascii(exif, Tag::Artist));
    add("Copyright", ascii(exif, Tag::Copyright));
    add("Time zone", ascii(exif, Tag::OffsetTimeOriginal));
    info.rating = info.rating.or_else(|| {
        exif.get_field(Tag(exif::Context::Tiff, 0x4746), In::PRIMARY)
            .and_then(|f| f.value.get_uint(0))
            .map(|r| r.min(5) as u8)
    });
    info.caption = info
        .caption
        .take()
        .or_else(|| ascii(exif, Tag::ImageDescription).and_then(real_caption));
}

fn apply_xmp(info: &mut ImageInfo, path: &Path, embedded: bool) {
    let merged = xmp::files::merge(
        xmp::files::read_sidecar(path),
        if embedded {
            xmp::files::read_embedded(path)
        } else {
            None
        },
    );
    if let Some(r) = merged.rating {
        info.rating = Some(r.clamp(0, 5) as u8);
    }
    if let Some(c) = merged.caption {
        info.caption = Some(c);
    }
    if !merged.keywords.is_empty() {
        info.keywords = merged.keywords;
    }
    if let Some(d) = merged.date_created.or(merged.date_time_original) {
        info.taken_at = Some(d);
    }
    if let Some((lat, lon)) = merged.gps.filter(|&(lat, lon)| !(lat == 0.0 && lon == 0.0)) {
        info.gps = Some(Gps { lat, lon });
    }
    info.sidecar = merged.sidecar.map(|p| p.to_string_lossy().into_owned());
    info.writable_in_file = xmp::files::writes_into_file(path);
}

fn read_exif_file(path: &Path) -> Option<Exif> {
    let f = std::fs::File::open(path).ok()?;
    exif::Reader::new()
        .read_from_container(&mut std::io::BufReader::new(f))
        .ok()
}

fn image_dims(path: &Path, ext: &str) -> Option<(u32, u32)> {
    if is_jpeg(ext) {
        let head = jpegmeta::read_head(path).ok()?;
        let h = jpegmeta::parse_head(&head)?;
        if h.width > 0 {
            return Some(orient::oriented_dims(h.width, h.height, h.orientation));
        }
    }
    #[cfg(windows)]
    if let Ok(src) = crate::decode::wic::open_file(path) {
        return Some(src.oriented_dims());
    }
    let (w, h) = image::image_dimensions(path).ok()?;
    let o = if matches!(ext, "tif" | "tiff") {
        std::fs::read(path)
            .map(|b| jpegmeta::tiff_orientation(&b))
            .unwrap_or(1)
    } else {
        1
    };
    Some(orient::oriented_dims(w, h, o))
}

fn raw_info(path: &Path, info: &mut ImageInfo) -> Result<(), String> {
    let md = crate::decode::raw::metadata(path)?;
    let make = if md.canonical_make.is_empty() {
        md.make.clone()
    } else {
        md.canonical_make.clone()
    };
    let fmt = md
        .format
        .map(|f| f.name().to_string())
        .unwrap_or_else(|| ext_of(path).to_ascii_uppercase());
    info.format = if make.is_empty() || fmt == "DNG" {
        fmt
    } else {
        format!("{make} {fmt}")
    };
    let (w, h) = orient::oriented_dims(md.width, md.height, md.orientation as u16);
    if w > 0 && h > 0 {
        (info.width, info.height) = (Some(w), Some(h));
    }
    let nz = |s: &str| (!s.trim().is_empty()).then(|| s.trim().to_string());
    info.camera_make = nz(&md.make);
    info.camera_model = nz(&md.model);
    info.lens = md.lens.model.as_deref().and_then(nz);
    info.taken_at = md
        .capture_time
        .as_deref()
        .map(|t| t.chars().take(19).collect());
    info.exposure = md.exposure.exposure_time.and_then(fmt_exposure);
    info.f_number = md.exposure.f_number.and_then(|f| fmt_f_number(f as f64));
    info.iso = md.exposure.iso;
    info.focal_length = md.exposure.focal_length.and_then(|f| fmt_focal(f as f64));
    if let Some(g) = &md.gps
        && let (Some(lat), Some(lon)) = (g.latitude, g.longitude)
    {
        info.gps = Some(Gps { lat, lon });
    }
    if let Some(e) = md.exposure.focal_length_35mm.filter(|&v| v > 0) {
        info.extra
            .push(("35 mm equivalent".into(), format!("{e} mm")));
    }
    if let Some(b) = md.exposure.exposure_bias {
        info.extra.push((
            "Exposure bias".into(),
            format!("{} EV", trim_num(b as f64, 1)),
        ));
    }
    if md.bits_per_sample > 0 {
        info.extra
            .push(("Bit depth".into(), format!("{} bit", md.bits_per_sample)));
    }
    if let Some(c) = md.compression {
        info.extra.push(("Compression".into(), format!("{c:?}")));
    }
    if let Some(fw) = md.firmware.as_deref().and_then(nz) {
        info.extra.push(("Firmware".into(), fw));
    }
    if let Some(tiff) = crate::decode::raw::exif_tiff(path)
        && let Ok(exif) = exif::Reader::new().read_raw(tiff)
    {
        fill_from_exif(info, &exif);
    }
    Ok(())
}

pub fn image_info(path: &str) -> Result<ImageInfo, String> {
    let p = Path::new(path);
    let meta = std::fs::metadata(p).map_err(|e| format!("{path}: {e}"))?;
    let ext = ext_of(p);
    let mut info = ImageInfo {
        path: path.to_string(),
        name: p
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
        size: meta.len(),
        modified_ms: modified_ms(&meta),
        format: format_name(&ext),
        ..Default::default()
    };
    match kind_of_ext(&ext) {
        Some(FileKind::Raw) => {
            if let Err(e) = raw_info(p, &mut info) {
                info.extra.push(("Note".into(), e));
            }
        }
        Some(FileKind::Image) => {
            if let Some((w, h)) = image_dims(p, &ext) {
                (info.width, info.height) = (Some(w), Some(h));
            }
            if let Some(exif) = read_exif_file(p) {
                fill_from_exif(&mut info, &exif);
            }
        }
        Some(FileKind::Video) | None => {}
    }
    let embedded = matches!(kind_of_ext(&ext), Some(FileKind::Raw | FileKind::Image));
    apply_xmp(&mut info, p, embedded);
    Ok(info)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_values() {
        assert_eq!(fmt_exposure(1.0 / 250.0).as_deref(), Some("1/250 s"));
        assert_eq!(fmt_exposure(0.0166).as_deref(), Some("1/60 s"));
        assert_eq!(fmt_exposure(0.5).as_deref(), Some("0.5 s"));
        assert_eq!(fmt_exposure(2.0).as_deref(), Some("2 s"));
        assert_eq!(fmt_exposure(0.0), None);
        assert_eq!(fmt_f_number(2.8).as_deref(), Some("f/2.8"));
        assert_eq!(fmt_f_number(8.0).as_deref(), Some("f/8"));
        assert_eq!(fmt_f_number(1.7799999).as_deref(), Some("f/1.8"));
        assert_eq!(fmt_focal(35.0).as_deref(), Some("35 mm"));
        assert_eq!(fmt_focal(4.25).as_deref(), Some("4.2 mm"));
        assert_eq!(fmt_flash(0x10), "Off");
        assert_eq!(fmt_flash(0x18), "Did not fire (auto)");
        assert_eq!(fmt_flash(0x19), "Fired (auto)");
        assert_eq!(fmt_flash(0x09), "Fired (forced)");
        assert_eq!(fmt_flash(0x59), "Fired (auto), red-eye reduction");
        assert_eq!(fmt_flash(0x20), "No flash");
        assert_eq!(fmt_flash(0), "Did not fire");
    }

    #[test]
    fn exif_dates() {
        assert_eq!(
            exif_datetime_to_iso("2023:05:01 12:34:56").as_deref(),
            Some("2023-05-01T12:34:56")
        );
        assert_eq!(
            exif_datetime_to_iso("2023:05:01 12:34:56\0").as_deref(),
            Some("2023-05-01T12:34:56")
        );
        assert_eq!(exif_datetime_to_iso("0000:00:00 00:00:00"), None);
        assert_eq!(exif_datetime_to_iso("    :  :     :  :  "), None);
        assert_eq!(exif_datetime_to_iso("garbage"), None);
    }
}
