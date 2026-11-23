use std::io::Read;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::{Edits, XmpFields, merge_keywords, new_packet, read_fields, update_packet};
use crate::formats::{ext_of, is_jpeg};
use crate::jpegmeta;
use crate::listing::modified_ms;

pub const JPEG_XMP_ID: &[u8] = b"http://ns.adobe.com/xap/1.0/\0";
const SCAN_BYTES: u64 = 4 * 1024 * 1024;
const MAX_SIDECAR_BYTES: u64 = 16 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Target {
    Sidecar,
    File,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WriteOutcome {
    pub modified_ms: i64,
    pub sidecar: Option<String>,
    pub wrote_file: bool,
}

pub fn sidecar_candidates(media: &Path) -> Vec<PathBuf> {
    let stem = media.with_extension("");
    let mut out = Vec::new();
    for ext in ["xmp", "XMP"] {
        out.push(PathBuf::from(format!("{}.{ext}", stem.display())));
    }
    for ext in ["xmp", "XMP"] {
        out.push(PathBuf::from(format!("{}.{ext}", media.display())));
    }
    out
}

pub fn existing_sidecar(media: &Path) -> Option<PathBuf> {
    sidecar_candidates(media).into_iter().find(|p| p.is_file())
}

pub fn sidecar_for_write(media: &Path) -> PathBuf {
    existing_sidecar(media).unwrap_or_else(|| PathBuf::from(format!("{}.xmp", media.display())))
}

fn read_text(path: &Path) -> Result<String, String> {
    let len = std::fs::metadata(path).map_err(|e| e.to_string())?.len();
    if len > MAX_SIDECAR_BYTES {
        return Err(format!("{} is too big for an XMP sidecar", path.display()));
    }
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    String::from_utf8(bytes).map_err(|_| format!("{} is not UTF-8 text", path.display()))
}

pub fn read_sidecar(media: &Path) -> Option<(PathBuf, XmpFields)> {
    let path = existing_sidecar(media)?;
    let fields = read_text(&path).ok().and_then(|t| read_fields(&t).ok())?;
    Some((path, fields))
}

fn jpeg_xmp_segment(data: &[u8]) -> Option<jpegmeta::Segment> {
    jpegmeta::segments(data)?
        .into_iter()
        .find(|s| s.marker == 0xE1 && data[s.payload.clone()].starts_with(JPEG_XMP_ID))
}

fn scan_packet(head: &[u8]) -> Option<String> {
    let open = b"<x:xmpmeta";
    let close = b"</x:xmpmeta>";
    let start = head.windows(open.len()).position(|w| w == open)?;
    let len = head[start..]
        .windows(close.len())
        .position(|w| w == close)?;
    String::from_utf8(head[start..start + len + close.len()].to_vec()).ok()
}

pub fn embedded_packet(path: &Path) -> Option<String> {
    let ext = ext_of(path);
    if is_jpeg(&ext) {
        let head = jpegmeta::read_head(path).ok()?;
        let seg = jpeg_xmp_segment(&head)?;
        let payload = &head[seg.payload.start + JPEG_XMP_ID.len()..seg.payload.end];
        return String::from_utf8(payload.to_vec()).ok();
    }
    let mut head = Vec::new();
    std::fs::File::open(path)
        .ok()?
        .take(SCAN_BYTES)
        .read_to_end(&mut head)
        .ok()?;
    scan_packet(&head)
}

pub fn read_embedded(path: &Path) -> Option<XmpFields> {
    embedded_packet(path).and_then(|p| read_fields(&p).ok())
}

#[derive(Debug, Default, Clone, PartialEq)]
pub struct Merged {
    pub rating: Option<i32>,
    pub caption: Option<String>,
    pub keywords: Vec<String>,
    pub date_created: Option<String>,
    pub date_time_original: Option<String>,
    pub gps: Option<(f64, f64)>,
    pub sidecar: Option<PathBuf>,
}

pub fn merge(sidecar: Option<(PathBuf, XmpFields)>, embedded: Option<XmpFields>) -> Merged {
    let (path, side) = match sidecar {
        Some((p, f)) => (Some(p), f),
        None => (None, XmpFields::default()),
    };
    let emb = embedded.unwrap_or_default();
    let subject = side
        .subject
        .clone()
        .or(emb.subject.clone())
        .unwrap_or_default();
    let hierarchical = side
        .hierarchical
        .clone()
        .or(emb.hierarchical.clone())
        .unwrap_or_default();
    Merged {
        rating: side.rating.or(emb.rating),
        caption: side.caption.or(emb.caption),
        keywords: merge_keywords(&subject, &hierarchical),
        date_created: side.date_created.or(emb.date_created),
        date_time_original: side.date_time_original,
        gps: side.gps,
        sidecar: path,
    }
}

pub fn read_merged(path: &Path) -> Merged {
    merge(read_sidecar(path), read_embedded(path))
}

pub fn writes_into_file(path: &Path) -> bool {
    is_jpeg(&ext_of(path))
}

fn write_sidecar(media: &Path, edits: &Edits) -> Result<PathBuf, String> {
    let target = sidecar_for_write(media);
    let text = if target.is_file() {
        update_packet(&read_text(&target)?, edits)
            .map_err(|e| format!("Couldn't update {}: {e}", target.display()))?
    } else {
        new_packet(edits)?
    };
    jpegmeta::replace_file(&target, text.as_bytes())?;
    Ok(target)
}

fn write_jpeg(path: &Path, edits: &Edits) -> Result<(), String> {
    let data = std::fs::read(path).map_err(|e| e.to_string())?;
    let segs = jpegmeta::segments(&data).ok_or("not a JPEG file")?;
    if !segs.iter().any(|s| s.marker == 0xDA) {
        return Err("the JPEG header is truncated".into());
    }
    let existing = jpeg_xmp_segment(&data);
    let packet = match &existing {
        Some(seg) => {
            let text =
                std::str::from_utf8(&data[seg.payload.start + JPEG_XMP_ID.len()..seg.payload.end])
                    .map_err(|_| "the picture's XMP is not UTF-8 text".to_string())?;
            update_packet(text, edits)?
        }
        None => new_packet(edits)?,
    };
    let len = 2 + JPEG_XMP_ID.len() + packet.len();
    if len > 0xFFFF {
        return Err("the picture's metadata would not fit in one JPEG XMP block".into());
    }
    let mut seg = vec![0xFF, 0xE1];
    seg.extend_from_slice(&(len as u16).to_be_bytes());
    seg.extend_from_slice(JPEG_XMP_ID);
    seg.extend_from_slice(packet.as_bytes());
    let cut = match &existing {
        Some(s) => s.start..s.end(),
        None => {
            let at = segs
                .iter()
                .take_while(|s| (0xE0..=0xEF).contains(&s.marker))
                .filter(|s| s.marker == 0xE0 || s.marker == 0xE1)
                .map(|s| s.end())
                .last()
                .unwrap_or(2);
            at..at
        }
    };
    let mut out = Vec::with_capacity(data.len() + seg.len());
    out.extend_from_slice(&data[..cut.start]);
    out.extend_from_slice(&seg);
    out.extend_from_slice(&data[cut.end..]);
    jpegmeta::replace_file(path, &out)
}

pub fn write(path: &str, edits: &Edits, target: Target) -> Result<WriteOutcome, String> {
    let p = Path::new(path);
    if !p.is_file() {
        return Err(format!("{path} not found"));
    }
    if edits.is_empty() {
        return Err("nothing to save".into());
    }
    let mut sidecar = None;
    let mut wrote_file = false;
    match target {
        Target::Sidecar => sidecar = Some(write_sidecar(p, edits)?),
        Target::File => {
            if !writes_into_file(p) {
                return Err(format!(
                    "Saving into .{} files isn't supported. Choose \"Next to the photo (XMP sidecar)\" in Settings.",
                    ext_of(p)
                ));
            }
            write_jpeg(p, edits)?;
            wrote_file = true;
            if existing_sidecar(p).is_some() {
                sidecar = Some(write_sidecar(p, edits)?);
            }
        }
    }
    let meta = std::fs::metadata(p).map_err(|e| e.to_string())?;
    Ok(WriteOutcome {
        modified_ms: modified_ms(&meta),
        sidecar: sidecar.map(|s| s.to_string_lossy().into_owned()),
        wrote_file,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("lpview-xmp-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn tiny_jpeg() -> Vec<u8> {
        let img = image::RgbImage::from_pixel(8, 8, image::Rgb([200, 30, 30]));
        let mut out = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgb8(img)
            .write_to(&mut out, image::ImageFormat::Jpeg)
            .unwrap();
        out.into_inner()
    }

    fn rating(r: u8) -> Edits {
        Edits {
            rating: Some(r),
            ..Default::default()
        }
    }

    #[test]
    fn names_sidecars_like_the_server() {
        let c = sidecar_candidates(Path::new("C:/p/IMG_1.CR2"));
        let names: Vec<String> = c
            .iter()
            .map(|p| p.file_name().unwrap().to_string_lossy().into_owned())
            .collect();
        assert_eq!(
            names,
            ["IMG_1.xmp", "IMG_1.XMP", "IMG_1.CR2.xmp", "IMG_1.CR2.XMP"]
        );
    }

    #[test]
    fn creates_an_extension_qualified_sidecar_then_reuses_an_existing_one() {
        let dir = temp_dir("sidecar");
        let jpg = dir.join("a.jpg");
        std::fs::write(&jpg, tiny_jpeg()).unwrap();
        let before = std::fs::read(&jpg).unwrap();
        let out = write(jpg.to_str().unwrap(), &rating(3), Target::Sidecar).unwrap();
        assert!(out.sidecar.as_deref().unwrap().ends_with("a.jpg.xmp"));
        assert!(!out.wrote_file);
        assert_eq!(std::fs::read(&jpg).unwrap(), before);
        assert_eq!(read_merged(&jpg).rating, Some(3));

        let raw = dir.join("b.cr2");
        std::fs::write(&raw, b"not really raw").unwrap();
        std::fs::write(dir.join("b.xmp"), "<x:xmpmeta xmlns:x='adobe:ns:meta/'><rdf:RDF xmlns:rdf='http://www.w3.org/1999/02/22-rdf-syntax-ns#'><rdf:Description rdf:about='' xmlns:xmp='http://ns.adobe.com/xap/1.0/' xmp:Label='Red'/></rdf:RDF></x:xmpmeta>").unwrap();
        let out = write(
            raw.to_str().unwrap(),
            &Edits {
                caption: Some("Shared sidecar".into()),
                ..Default::default()
            },
            Target::Sidecar,
        )
        .unwrap();
        assert!(out.sidecar.as_deref().unwrap().ends_with("b.xmp"));
        let text = std::fs::read_to_string(dir.join("b.xmp")).unwrap();
        assert!(text.contains("xmp:Label='Red'"));
        assert_eq!(read_merged(&raw).caption.as_deref(), Some("Shared sidecar"));
        assert!(!dir.join("b.cr2.xmp").exists());
    }

    #[test]
    fn writes_into_a_jpeg_losslessly_and_refuses_other_formats() {
        let dir = temp_dir("embed");
        let jpg = dir.join("c.jpg");
        let original = tiny_jpeg();
        std::fs::write(&jpg, &original).unwrap();
        let edits = Edits {
            rating: Some(5),
            keywords: Some(vec!["k1".into(), "k2".into()]),
            ..Default::default()
        };
        let out = write(jpg.to_str().unwrap(), &edits, Target::File).unwrap();
        assert!(out.wrote_file && out.sidecar.is_none());
        let data = std::fs::read(&jpg).unwrap();
        let sos = |d: &[u8]| {
            let s = jpegmeta::segments(d).unwrap();
            let sos = s.iter().find(|s| s.marker == 0xDA).unwrap().start;
            d[sos..].to_vec()
        };
        assert_eq!(sos(&data), sos(&original));
        let m = read_merged(&jpg);
        assert_eq!(
            (m.rating, m.keywords.clone()),
            (Some(5), vec!["k1".to_string(), "k2".to_string()])
        );
        write(jpg.to_str().unwrap(), &rating(2), Target::File).unwrap();
        let data2 = std::fs::read(&jpg).unwrap();
        assert_eq!(
            data2
                .windows(JPEG_XMP_ID.len())
                .filter(|w| *w == JPEG_XMP_ID)
                .count(),
            1
        );
        assert_eq!(read_merged(&jpg).rating, Some(2));
        assert_eq!(read_merged(&jpg).keywords.len(), 2);
        assert!(image::load_from_memory(&data2).is_ok());

        write(jpg.to_str().unwrap(), &rating(1), Target::Sidecar).unwrap();
        write(jpg.to_str().unwrap(), &rating(4), Target::File).unwrap();
        assert_eq!(read_sidecar(&jpg).unwrap().1.rating, Some(4));

        let png = dir.join("d.png");
        std::fs::write(&png, b"x").unwrap();
        let err = write(png.to_str().unwrap(), &rating(1), Target::File).unwrap_err();
        assert!(err.contains("Saving into .png files isn't supported"));
        assert!(
            write(
                dir.join("missing.jpg").to_str().unwrap(),
                &rating(1),
                Target::Sidecar
            )
            .is_err()
        );
        assert!(write(jpg.to_str().unwrap(), &Edits::default(), Target::Sidecar).is_err());
    }

    #[test]
    fn refuses_to_overwrite_a_sidecar_it_cannot_read() {
        let dir = temp_dir("broken");
        let jpg = dir.join("e.jpg");
        std::fs::write(&jpg, tiny_jpeg()).unwrap();
        std::fs::write(dir.join("e.xmp"), "<x:xmpmeta><unclosed>").unwrap();
        assert!(write(jpg.to_str().unwrap(), &rating(1), Target::Sidecar).is_err());
        assert_eq!(
            std::fs::read_to_string(dir.join("e.xmp")).unwrap(),
            "<x:xmpmeta><unclosed>"
        );
    }

    #[test]
    fn the_sidecar_wins_over_the_embedded_packet() {
        let emb = XmpFields {
            rating: Some(1),
            caption: Some("embedded".into()),
            subject: Some(vec!["e".into()]),
            date_created: Some("2001-01-01T00:00:00".into()),
            ..Default::default()
        };
        let side = XmpFields {
            rating: Some(4),
            hierarchical: Some(vec!["a|b".into()]),
            ..Default::default()
        };
        let m = merge(Some((PathBuf::from("x.xmp"), side)), Some(emb));
        assert_eq!(m.rating, Some(4));
        assert_eq!(m.caption.as_deref(), Some("embedded"));
        assert_eq!(m.keywords, ["e", "b"]);
        assert_eq!(m.date_created.as_deref(), Some("2001-01-01T00:00:00"));
        assert!(scan_packet(b"junk<x:xmpmeta a='1'></x:xmpmeta>junk").is_some());
        assert!(scan_packet(b"<x:xmpmeta>").is_none());
    }
}
