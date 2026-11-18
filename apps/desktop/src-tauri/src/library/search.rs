//! Local search: the words indexed per file, and the user's query as an FTS5 expression.
//!
//! Each file is indexed under its name, the folders between its root and itself (and the root's
//! own name), its type ("raw", "video", "photo", the extension and format name), camera and lens,
//! and its date as words: year, month name (long and short), `yyyy-mm` and `yyyy-mm-dd`. A query
//! is split into words and every word must prefix-match one of those: "march 2023", "canon raw",
//! "holiday 2019 heic".

use chrono::{DateTime, Datelike};

pub struct TermSource {
    pub path: String,
    pub name: String,
    pub kind: String,
    pub format: Option<String>,
    pub camera: Option<String>,
    pub lens: Option<String>,
    pub sort_ms: i64,
    pub dated: bool,
    pub root: Option<String>,
}

const MONTHS: [&str; 12] = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
];

/// Date words of local wall-clock milliseconds (read as UTC): "2023 march mar 2023-03 2023-03-15".
pub fn date_terms(ms: i64) -> String {
    let Some(d) = DateTime::from_timestamp_millis(ms) else {
        return String::new();
    };
    let month = MONTHS[d.month0() as usize];
    format!(
        "{y} {month} {short} {y}-{m:02} {y}-{m:02}-{day:02}",
        y = d.year(),
        short = &month[..3],
        m = d.month(),
        day = d.day()
    )
}

/// The folders between the root and the file, plus the root folder's own name.
fn folder_terms(path: &str, root: Option<&str>) -> String {
    let p = std::path::Path::new(path);
    let parent = p.parent();
    let (base, rel) = match (root, parent) {
        (Some(r), Some(parent)) => {
            let r = std::path::Path::new(r);
            let rel = parent.strip_prefix(r).ok();
            (r.file_name(), rel)
        }
        (None, Some(parent)) => (parent.file_name(), None),
        _ => (None, None),
    };
    let mut out = String::new();
    if let Some(b) = base {
        out.push_str(&b.to_string_lossy());
    }
    if let Some(rel) = rel {
        for c in rel.components() {
            out.push(' ');
            out.push_str(&c.as_os_str().to_string_lossy());
        }
    }
    out
}

pub fn terms(s: &TermSource) -> String {
    let ext = std::path::Path::new(&s.name)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    let kind_words = match s.kind.as_str() {
        "raw" => "raw photo",
        "video" => "video movie",
        _ => "photo picture image",
    };
    let mut parts = vec![
        s.name.clone(),
        ext,
        kind_words.to_string(),
        folder_terms(&s.path, s.root.as_deref()),
        date_terms(s.sort_ms),
    ];
    if !s.dated {
        parts.push("undated".into());
    }
    parts.extend(s.format.iter().cloned());
    parts.extend(s.camera.iter().cloned());
    parts.extend(s.lens.iter().cloned());
    parts.join(" ")
}

/// The words of a query, lower-case, split like the FTS5 `unicode61` tokenizer splits them.
pub fn query_words(q: &str) -> Vec<String> {
    q.split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .map(|w| w.to_lowercase())
        .collect()
}

/// An FTS5 expression where every word prefix-matches (implicit AND), or None for an empty query.
pub fn fts_query(q: &str) -> Option<String> {
    let words = query_words(q);
    (!words.is_empty()).then(|| {
        words
            .iter()
            .map(|w| format!("\"{w}\"*"))
            .collect::<Vec<_>>()
            .join(" ")
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn date_words() {
        // 2023-03-15T10:00:00 as wall-clock milliseconds.
        let ms = chrono::NaiveDate::from_ymd_opt(2023, 3, 15)
            .unwrap()
            .and_hms_opt(10, 0, 0)
            .unwrap()
            .and_utc()
            .timestamp_millis();
        assert_eq!(date_terms(ms), "2023 march mar 2023-03 2023-03-15");
    }

    #[test]
    fn queries() {
        assert_eq!(fts_query("  "), None);
        assert_eq!(
            fts_query("March 2023").as_deref(),
            Some("\"march\"* \"2023\"*")
        );
        assert_eq!(
            fts_query("img_12\"x").as_deref(),
            Some("\"img\"* \"12\"* \"x\"*")
        );
        assert_eq!(fts_query("Köln").as_deref(), Some("\"köln\"*"));
    }

    #[test]
    fn terms_cover_folders_type_and_camera() {
        let sep = std::path::MAIN_SEPARATOR;
        let root = format!("C:{sep}Pics");
        let t = terms(&TermSource {
            path: format!("{root}{sep}Italy 2019{sep}Rome{sep}DSC_1.NEF"),
            name: "DSC_1.NEF".into(),
            kind: "raw".into(),
            format: Some("Nikon NEF".into()),
            camera: Some("NIKON D750".into()),
            lens: None,
            sort_ms: 0,
            dated: false,
            root: Some(root),
        });
        for w in [
            "DSC_1.NEF",
            "nef",
            "raw",
            "Pics",
            "Italy 2019",
            "Rome",
            "1970 january",
            "undated",
            "NIKON D750",
        ] {
            assert!(t.contains(w), "{w} missing from {t}");
        }
    }
}
