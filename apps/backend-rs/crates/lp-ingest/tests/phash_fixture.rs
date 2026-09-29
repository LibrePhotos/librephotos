//! pHash parity against Python's imagehash on the fixture's big thumbnails.
//! Needs `LP_PHASH_GOLDEN` = a file of `<path>\t<hash>` lines produced by
//! `imagehash.phash(Image.open(path).convert("RGB"))`; skipped otherwise.

#[test]
fn phash_matches_python_golden() {
    let Ok(golden) = std::env::var("LP_PHASH_GOLDEN") else {
        eprintln!("LP_PHASH_GOLDEN not set; skipping");
        return;
    };
    let text = std::fs::read_to_string(golden).unwrap();
    let (mut total, mut same) = (0, 0);
    for line in text.lines().filter(|l| !l.trim().is_empty()) {
        let (path, want) = line.split_once('\t').unwrap();
        let got = lp_ingest::phash::phash_webp_file(std::path::Path::new(path)).unwrap();
        total += 1;
        if got == want.trim() {
            same += 1;
        } else {
            eprintln!("MISMATCH {path}: rust {got} python {want}");
        }
    }
    eprintln!("pHash parity: {same}/{total}");
    assert_eq!(same, total);
}

/// Dominant colour against Pillow (`LP_COLOR_GOLDEN`: `<path>\t[r, g, b]`).
/// Prints the match rate; the value is cosmetic, so no exactness is asserted.
#[test]
fn dominant_colour_against_pillow_golden() {
    let Ok(golden) = std::env::var("LP_COLOR_GOLDEN") else {
        eprintln!("LP_COLOR_GOLDEN not set; skipping");
        return;
    };
    let text = std::fs::read_to_string(golden).unwrap();
    let (mut total, mut same) = (0, 0);
    for line in text.lines().filter(|l| !l.trim().is_empty()) {
        let (path, want) = line.split_once('\t').unwrap();
        let got = lp_ingest::color::dominant_webp_file(std::path::Path::new(path))
            .map(lp_core::codecs::DominantColor::format)
            .unwrap_or_default();
        total += 1;
        if got == want.trim() {
            same += 1;
        } else {
            eprintln!("DIFF {path}: rust {got} pillow {want}");
        }
    }
    eprintln!("dominant colour parity: {same}/{total}");
}
