//! Thumbnails keep the colour profile but not the original's EXIF (GPS):
//! they are what shared and public views load. Needs libvips (`LP_VIPS_LIB`,
//! else the Django venv's) and the fixture; skipped otherwise.

use std::path::{Path, PathBuf};

const FIXTURE: &str = "C:/Users/Niaz/librephotos/rust-pg/fixture/data/alice/trips/berlin_01.jpg";

fn vips_lib() -> Option<PathBuf> {
    if let Some(p) = std::env::var_os("LP_VIPS_LIB") {
        return Some(PathBuf::from(p));
    }
    let venv = std::env::var("LP_TEST_VENV")
        .unwrap_or_else(|_| "C:/Users/Niaz/librephotos/wt-windev/apps/backend/.venv-win".into());
    let site = Path::new(&venv).join("Lib").join("site-packages");
    std::fs::read_dir(site)
        .ok()?
        .flatten()
        .map(|e| e.path())
        .find(|p| {
            p.file_name()
                .is_some_and(|n| n.to_string_lossy().starts_with("libvips-42"))
        })
}

/// The RIFF chunk ids of a WebP file.
fn chunks(data: &[u8]) -> Vec<String> {
    assert_eq!(&data[..4], b"RIFF");
    assert_eq!(&data[8..12], b"WEBP");
    let mut out = Vec::new();
    let mut i = 12;
    while i + 8 <= data.len() {
        let n = u32::from_le_bytes(data[i + 4..i + 8].try_into().unwrap()) as usize;
        out.push(String::from_utf8_lossy(&data[i..i + 4]).into_owned());
        i += 8 + n + (n & 1);
    }
    out
}

#[test]
fn thumbnails_drop_exif_by_default() {
    let (Some(lib), true) = (vips_lib(), Path::new(FIXTURE).exists()) else {
        eprintln!("libvips or the fixture not found; skipping");
        return;
    };
    // SAFETY: the test process sets no other LP_THUMB_KEEP concurrently.
    unsafe { std::env::remove_var("LP_THUMB_KEEP") };
    let original = std::fs::read(FIXTURE).unwrap();
    assert!(
        original.windows(4).any(|w| w == b"Exif"),
        "fixture has no EXIF"
    );
    let v = lp_ingest::vips::get(Some(&lib)).expect("libvips loads");
    let img = v.thumbnail_file(Path::new(FIXTURE), 250).unwrap();
    let dir = tempfile::tempdir().unwrap();
    let out = dir.path().join("t.webp");
    img.webpsave(&out, 95, Some(2)).unwrap();
    let ids = chunks(&std::fs::read(&out).unwrap());
    assert!(!ids.iter().any(|c| c == "EXIF" || c == "XMP "), "{ids:?}");
}
