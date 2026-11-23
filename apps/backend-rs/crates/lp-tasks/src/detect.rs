//! Pure media-category heuristics: `api/document_detection.py` and
//! `api/screenshot_detection.py`, ported rule for rule.

use std::sync::LazyLock;

use regex::Regex;

const DENSE_TEXT_AREA_FRACTION: f64 = 0.18;
const DENSE_TEXT_MIN_CHARS: usize = 40;
const MODERATE_TEXT_AREA_FRACTION: f64 = 0.08;
const MODERATE_TEXT_MIN_CHARS: usize = 20;

const STRONG_SIGLIP_LABELS: [&str; 6] = [
    "receipt",
    "document",
    "invoice",
    "business card",
    "identity document",
    "book page",
];
const WEAK_SIGLIP_LABELS: [&str; 4] = ["ticket", "menu", "whiteboard", "handwritten note"];

static CURRENCY_RE: LazyLock<Regex> = LazyLock::new(|| {
    let symbols = "[$€£¥₹₩₽]";
    let amount = r"\d(?:[\d.,]*\d)?";
    Regex::new(&format!(r"{symbols}\s?{amount}|{amount}\s?{symbols}")).expect("currency regex")
});

static TOTAL_KEYWORD_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b(?:TOTAL|SUBTOTAL|SUMME|GESAMT|MWST|TVA|IVA|TOTAAL|ИТОГО)\b|合計|小計")
        .expect("total regex")
});

fn content_length(text: Option<&str>) -> usize {
    text.map(|t| t.chars().filter(|c| !c.is_whitespace()).count())
        .unwrap_or(0)
}

pub fn has_currency_amount(text: Option<&str>) -> bool {
    text.is_some_and(|t| !t.is_empty() && CURRENCY_RE.is_match(t))
}

pub fn has_total_keyword(text: Option<&str>) -> bool {
    text.is_some_and(|t| !t.is_empty() && TOTAL_KEYWORD_RE.is_match(t))
}

/// `classify_document`: a strong SigLIP label alone, else two distinct
/// medium/weak signals.
pub fn classify_document(
    ocr_text: Option<&str>,
    text_area_fraction: Option<f64>,
    siglip_labels: &[String],
) -> bool {
    let labels: Vec<String> = siglip_labels.iter().map(|l| l.to_lowercase()).collect();
    let has = |set: &[&str]| labels.iter().any(|l| set.contains(&l.as_str()));
    let fraction = text_area_fraction.unwrap_or(0.0);
    let chars = content_length(ocr_text);

    if has(&STRONG_SIGLIP_LABELS) {
        return true;
    }
    let dense_text = fraction >= DENSE_TEXT_AREA_FRACTION && chars >= DENSE_TEXT_MIN_CHARS;
    let receipt = has_currency_amount(ocr_text) && has_total_keyword(ocr_text);
    let weak_siglip = has(&WEAK_SIGLIP_LABELS);
    let moderate_text =
        fraction >= MODERATE_TEXT_AREA_FRACTION && chars >= MODERATE_TEXT_MIN_CHARS && !dense_text;
    [dense_text, receipt, weak_siglip, moderate_text]
        .iter()
        .filter(|s| **s)
        .count()
        >= 2
}

const SCREENSHOT_PREFIXES: [&str; 7] = [
    "screenshot",
    "screen shot",
    "bildschirmfoto",
    "captura de pantalla",
    "capture d'ecran",
    "снимок экрана",
    "スクリーンショット",
];

/// What `screenshot_detection.classify` reads of a photo.
#[derive(Debug, Clone, Default)]
pub struct ScreenshotInput<'a> {
    pub main_path: Option<&'a str>,
    pub has_metadata: bool,
    pub camera_model: Option<&'a str>,
    pub aperture: Option<f64>,
    pub iso: Option<i32>,
    pub focal_length: Option<f64>,
    pub photo_gps: bool,
    pub metadata_gps: bool,
}

fn normalize(text: &str) -> String {
    text.to_lowercase()
        .replace('\u{2019}', "'")
        .replace(['_', '-'], " ")
}

fn matches_prefix(basename: &str) -> bool {
    let normalized = normalize(basename);
    SCREENSHOT_PREFIXES.iter().any(|prefix| {
        normalized
            .strip_prefix(prefix)
            .is_some_and(|rest| rest.chars().next().is_none_or(|c| !c.is_alphabetic()))
    })
}

/// `os.path.basename` on Windows (either separator).
pub fn basename(path: &str) -> &str {
    path.rsplit(['/', '\\']).next().unwrap_or(path)
}

/// `os.path.splitext(path)[1].lower()`: leading dots of the name are not an extension.
pub fn extension_lower(path: &str) -> String {
    let name = basename(path);
    let stem_start = name.len() - name.trim_start_matches('.').len();
    match name[stem_start..].rfind('.') {
        Some(i) => name[stem_start + i..].to_lowercase(),
        None => String::new(),
    }
}

pub fn is_screenshot(photo: &ScreenshotInput<'_>) -> bool {
    let path = photo.main_path.unwrap_or("");
    if !path.is_empty() {
        if matches_prefix(basename(path)) {
            return true;
        }
        // Only parent directories count: every part but the last.
        let parts: Vec<&str> = path.split(['/', '\\']).collect();
        if parts[..parts.len().saturating_sub(1)]
            .iter()
            .any(|p| p.to_lowercase() == "screenshots")
        {
            return true;
        }
    }
    if extension_lower(path) != ".png" {
        return false;
    }
    if photo.has_metadata {
        let camera = photo.camera_model.is_some_and(|m| !m.is_empty())
            || photo.aperture.is_some_and(|a| a != 0.0)
            || photo.iso.is_some_and(|i| i != 0)
            || photo.focal_length.is_some_and(|f| f != 0.0);
        if camera {
            return false;
        }
    }
    if photo.photo_gps || (photo.has_metadata && photo.metadata_gps) {
        return false;
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    fn labels(l: &[&str]) -> Vec<String> {
        l.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn documents() {
        assert!(classify_document(None, None, &labels(&["Receipt"])));
        assert!(!classify_document(None, None, &labels(&["menu"])));
        let receipt = "Coffee 3,50 €\nTOTAL 3,50 €";
        assert!(!classify_document(Some(receipt), Some(0.01), &[]));
        assert!(classify_document(
            Some(receipt),
            Some(0.01),
            &labels(&["ticket"])
        ));
        let long = "a".repeat(45);
        assert!(!classify_document(Some(&long), Some(0.2), &[]));
        assert!(classify_document(
            Some(&long),
            Some(0.2),
            &labels(&["whiteboard"])
        ));
        assert!(has_total_keyword(Some("итого 5")));
        assert!(has_total_keyword(Some("お会計 合計")));
        assert!(!has_total_keyword(Some("TOTALLY")));
        assert!(!has_currency_amount(Some("version 2.0 on 12.03.2024")));
        assert!(has_currency_amount(Some("£9.99")));
    }

    #[test]
    fn screenshots() {
        let s = |p: &str| {
            is_screenshot(&ScreenshotInput {
                main_path: Some(p),
                ..Default::default()
            })
        };
        assert!(s(r"C:\data\Screenshot_20240115-093000.jpg"));
        assert!(s("/data/Screen Shot 2020.jpg"));
        assert!(s("/data/Bildschirmfoto-2021.jpg"));
        assert!(!s("/data/screenshotly.jpg"));
        assert!(s("/data/Screenshots/IMG_1.jpg"));
        assert!(s("/data/foo.PNG"));
        assert!(!s("/data/foo.jpg"));
        let camera = ScreenshotInput {
            main_path: Some("/x/a.png"),
            has_metadata: true,
            iso: Some(100),
            ..Default::default()
        };
        assert!(!is_screenshot(&camera));
        let gps = ScreenshotInput {
            main_path: Some("/x/a.png"),
            photo_gps: true,
            ..Default::default()
        };
        assert!(!is_screenshot(&gps));
        assert_eq!(extension_lower("/a/.png"), "");
        assert_eq!(extension_lower("/a/b.tar.GZ"), ".gz");
    }
}
