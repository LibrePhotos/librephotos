//! `api/burst_detection_rules.py`: the user's burst rules (hard: EXIF tags
//! and filename patterns; soft: timestamp proximity and visual similarity).

use std::collections::HashMap;
use std::path::Path;
use std::sync::OnceLock;

use lp_core::extract::py_truthy;
use lp_db::stats_admin_stacks_dupes::detect::BurstCandidate;
use regex::Regex;
use serde_json::{Map, Value};

use super::phash::hamming;
use crate::stats_admin_stacks_dupes::stats::py_str;

pub const BURST_MODE: &str = "MakerNotes:BurstMode";
pub const CONTINUOUS_DRIVE: &str = "MakerNotes:ContinuousDrive";
pub const SEQUENCE_NUMBER: &str = "MakerNotes:SequenceNumber";
pub const IMAGE_NUMBER: &str = "EXIF:ImageNumber";
pub const SUBSEC_TIME_ORIGINAL: &str = "EXIF:SubSecTimeOriginal";
pub const CAMERA: &str = "EXIF:Model";

/// `BURST_FILENAME_PATTERNS` (all matched case-insensitively).
const PATTERNS: [(&str, &str); 5] = [
    ("burst_suffix", r"(?i)_BURST\d+"),
    ("sequence_suffix", r"(?i)_\d{3,}$"),
    ("bracketed_sequence", r"(?i)\(\d+\)$"),
    ("samsung_burst", r"(?i)_\d{3}_COVER"),
    ("iphone_burst", r"(?i)IMG_\d{4}_\d+"),
];

fn patterns() -> &'static [(&'static str, Regex)] {
    static P: OnceLock<Vec<(&'static str, Regex)>> = OnceLock::new();
    P.get_or_init(|| {
        PATTERNS
            .iter()
            .map(|(name, re)| (*name, Regex::new(re).expect("static pattern")))
            .collect()
    })
}

fn suffix_re(with_cover: bool) -> &'static Regex {
    static PLAIN: OnceLock<Regex> = OnceLock::new();
    static COVER: OnceLock<Regex> = OnceLock::new();
    if with_cover {
        COVER
            .get_or_init(|| Regex::new(r"(?i)(_BURST\d+|_\d{3,}|\(\d+\)|_COVER)$").expect("static"))
    } else {
        PLAIN.get_or_init(|| Regex::new(r"(_BURST\d+|_\d{3,}|\(\d+\))$").expect("static"))
    }
}

/// `re.search` with a user-supplied (Python-syntax) pattern; an invalid
/// pattern never matches.
fn search(pattern: &str, text: &str) -> bool {
    fancy_regex::Regex::new(pattern)
        .ok()
        .and_then(|re| re.is_match(text).ok())
        .unwrap_or(false)
}

/// EXIF values of one photo: every requested tag (None when absent), or
/// empty when the read failed.
pub type ExifTags = HashMap<String, Option<Value>>;

#[derive(Debug, Clone)]
pub struct Rule {
    pub rule_type: String,
    pub category: String,
    pub enabled: bool,
    pub params: Map<String, Value>,
}

/// `as_rules`: every config needs a `rule_type`.
pub fn parse_rules(config: &Value) -> Result<Vec<Rule>, String> {
    let parsed;
    let config = match config {
        Value::String(s) => {
            parsed = serde_json::from_str::<Value>(s).map_err(|e| e.to_string())?;
            &parsed
        }
        other => other,
    };
    let Some(items) = config.as_array() else {
        return Err("burst_detection_rules is not a list".into());
    };
    items
        .iter()
        .map(|item| {
            let params = item
                .as_object()
                .cloned()
                .ok_or("a burst rule is not an object")?;
            let rule_type = params
                .get("rule_type")
                .map(py_str)
                .ok_or_else(|| "'rule_type'".to_string())?;
            Ok(Rule {
                rule_type,
                category: params
                    .get("category")
                    .map(py_str)
                    .unwrap_or_else(|| "hard".into()),
                enabled: params.get("enabled").is_none_or(py_truthy),
                params,
            })
        })
        .collect()
}

impl Rule {
    fn param(&self, key: &str) -> Option<&Value> {
        self.params.get(key)
    }

    fn truthy_str(&self, key: &str) -> Option<String> {
        self.param(key).filter(|v| py_truthy(v)).map(py_str)
    }

    pub fn is_hard(&self) -> bool {
        self.category == "hard" && self.enabled
    }

    pub fn is_soft(&self) -> bool {
        self.category == "soft" && self.enabled
    }

    /// `get_required_exif_tags`.
    pub fn required_exif_tags(&self) -> Vec<String> {
        let mut tags = Vec::new();
        if let Some(cond) = self.truthy_str("condition_exif") {
            tags.push(cond.split("//").next().unwrap_or("").to_string());
        }
        match self.rule_type.as_str() {
            "exif_burst_mode" => tags.extend([BURST_MODE.into(), CONTINUOUS_DRIVE.into()]),
            "exif_sequence_number" => tags.extend([
                SEQUENCE_NUMBER.into(),
                IMAGE_NUMBER.into(),
                SUBSEC_TIME_ORIGINAL.into(),
            ]),
            _ => {}
        }
        tags
    }

    fn conditions_hold(&self, path: &str, exif: &ExifTags) -> bool {
        if let Some(cond) = self.truthy_str("condition_path")
            && !search(&cond, path)
        {
            return false;
        }
        if let Some(cond) = self.truthy_str("condition_filename") {
            let name = Path::new(path)
                .file_name()
                .map(|n| n.to_string_lossy())
                .unwrap_or_default();
            if !search(&cond, &name) {
                return false;
            }
        }
        if let Some(cond) = self.truthy_str("condition_exif") {
            let Some((tag, pattern)) = cond.split_once("//") else {
                return false;
            };
            let value = exif.get(tag).cloned().flatten().filter(py_truthy);
            match value {
                Some(v) if search(pattern, &py_str(&v)) => {}
                _ => return false,
            }
        }
        true
    }

    /// `is_burst_photo`: whether the photo is part of a burst, and the key
    /// grouping it with the rest of that burst.
    pub fn is_burst_photo(
        &self,
        photo: &BurstCandidate,
        exif: &ExifTags,
    ) -> (bool, Option<String>) {
        if !self.enabled {
            return (false, None);
        }
        let path = photo.main_file_path.as_deref().unwrap_or("");
        if !self.conditions_hold(path, exif) {
            return (false, None);
        }
        match self.rule_type.as_str() {
            "exif_burst_mode" => exif_burst_mode(photo, exif),
            "exif_sequence_number" => exif_sequence_number(photo, exif),
            "filename_pattern" => self.filename_pattern(photo),
            _ => (false, None),
        }
    }

    fn filename_pattern(&self, photo: &BurstCandidate) -> (bool, Option<String>) {
        let Some(path) = photo.main_file_path.as_deref() else {
            return (false, None);
        };
        let p = Path::new(path);
        let basename = p
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
        let directory = p
            .parent()
            .map(|d| d.display().to_string())
            .unwrap_or_default();
        let key = |with_cover: bool| {
            let base = suffix_re(with_cover).replace(&basename, "");
            Some(format!("filename_{directory}_{base}"))
        };
        if let Some(custom) = self.truthy_str("custom_pattern") {
            if search(&custom, &basename) {
                return (true, key(false));
            }
            return (false, None);
        }
        let pattern_type = self
            .param("pattern_type")
            .map(py_str)
            .unwrap_or_else(|| "all".into());
        let matched = patterns()
            .iter()
            .filter(|(name, _)| pattern_type == "all" || *name == pattern_type)
            .any(|(_, re)| re.is_match(&basename));
        if matched {
            (true, key(true))
        } else {
            (false, None)
        }
    }
}

/// `exif_tags.get(Tags.CAMERA, "unknown")` inside an f-string.
fn camera(exif: &ExifTags) -> String {
    match exif.get(CAMERA) {
        None => "unknown".into(),
        Some(None) => "None".into(),
        Some(Some(v)) => py_str(v),
    }
}

fn keyed(prefix: &str, photo: &BurstCandidate, exif: &ExifTags) -> (bool, Option<String>) {
    match photo.exif_timestamp {
        Some(ts) => (
            true,
            Some(format!(
                "{prefix}_{}_{}",
                camera(exif),
                ts.format("%Y%m%d_%H%M%S")
            )),
        ),
        None => (true, None),
    }
}

fn exif_burst_mode(photo: &BurstCandidate, exif: &ExifTags) -> (bool, Option<String>) {
    let get = |t: &str| exif.get(t).cloned().flatten().filter(py_truthy);
    if let Some(mode) = get(BURST_MODE)
        && ["1", "On", "True", "Yes"].contains(&py_str(&mode).as_str())
    {
        return keyed("burst", photo, exif);
    }
    if let Some(drive) = get(CONTINUOUS_DRIVE)
        && ["continuous", "on", "1"].contains(&py_str(&drive).to_lowercase().as_str())
    {
        return keyed("burst", photo, exif);
    }
    (false, None)
}

fn exif_sequence_number(photo: &BurstCandidate, exif: &ExifTags) -> (bool, Option<String>) {
    let valid = match exif.get(SEQUENCE_NUMBER).cloned().flatten() {
        Some(Value::Number(_) | Value::Bool(_)) => true,
        Some(Value::String(s)) => {
            let t = s.trim().replace('_', "");
            let digits = t.strip_prefix(['+', '-']).unwrap_or(&t);
            !digits.is_empty() && digits.chars().all(|c| c.is_ascii_digit())
        }
        _ => false,
    };
    if valid {
        keyed("seq", photo, exif)
    } else {
        (false, None)
    }
}

/// `group_photos_by_timestamp` over photos ordered by timestamp.
pub fn group_by_timestamp(
    photos: &[&BurstCandidate],
    interval_ms: f64,
    require_same_camera: bool,
) -> Vec<Vec<usize>> {
    let interval_us = (interval_ms * 1000.0).round() as i64;
    let mut groups = Vec::new();
    let mut current: Vec<usize> = Vec::new();
    let mut prev: Option<(usize, Option<String>)> = None;
    for (i, p) in photos.iter().enumerate() {
        let Some(ts) = p.exif_timestamp else { continue };
        let camera = (require_same_camera && p.has_metadata).then(|| {
            format!(
                "{}_{}",
                p.camera_make.as_deref().unwrap_or(""),
                p.camera_model.as_deref().unwrap_or("")
            )
        });
        match &prev {
            None => current = vec![i],
            Some((pi, prev_camera)) => {
                let prev_ts = photos[*pi].exif_timestamp.expect("kept only timestamped");
                let diff = (ts - prev_ts).num_microseconds().unwrap_or(i64::MAX);
                let same_camera = match (&camera, prev_camera) {
                    (Some(a), Some(b)) if require_same_camera => a == b,
                    _ => true,
                };
                if diff <= interval_us && same_camera {
                    current.push(i);
                } else {
                    if current.len() >= 2 {
                        groups.push(std::mem::take(&mut current));
                    }
                    current = vec![i];
                }
            }
        }
        prev = Some((i, camera));
    }
    if current.len() >= 2 {
        groups.push(current);
    }
    groups
}

/// `group_photos_by_visual_similarity`: runs of consecutive similar hashes.
pub fn group_by_visual(photos: &[&BurstCandidate], threshold: i64) -> Vec<Vec<usize>> {
    let with_hash: Vec<usize> = (0..photos.len())
        .filter(|&i| {
            photos[i]
                .perceptual_hash
                .as_deref()
                .is_some_and(|h| !h.is_empty())
        })
        .collect();
    if with_hash.len() < 2 {
        return Vec::new();
    }
    let hash = |i: usize| photos[i].perceptual_hash.as_deref().unwrap_or("");
    let mut groups = Vec::new();
    let mut current = vec![with_hash[0]];
    for w in with_hash.windows(2) {
        if i64::from(hamming(hash(w[1]), hash(w[0]))) <= threshold {
            current.push(w[1]);
        } else {
            if current.len() >= 2 {
                groups.push(std::mem::take(&mut current));
            }
            current = vec![w[1]];
        }
    }
    if current.len() >= 2 {
        groups.push(current);
    }
    groups
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{TimeZone, Utc};
    use serde_json::json;
    use uuid::Uuid;

    fn photo(path: &str, secs: Option<i64>) -> BurstCandidate {
        BurstCandidate {
            id: Uuid::new_v4(),
            exif_timestamp: secs.map(|s| Utc.timestamp_opt(1_700_000_000 + s, 0).unwrap()),
            added_on: Utc::now(),
            main_file_path: Some(path.into()),
            has_metadata: false,
            camera_make: None,
            camera_model: None,
            perceptual_hash: None,
        }
    }

    fn defaults() -> Vec<Rule> {
        parse_rules(&lp_db::write::users::default_burst_detection_rules()).unwrap()
    }

    #[test]
    fn default_rules() {
        let rules = defaults();
        assert_eq!(rules.iter().filter(|r| r.is_hard()).count(), 3);
        assert_eq!(rules.iter().filter(|r| r.is_soft()).count(), 0);
        assert!(parse_rules(&json!([{"name": "x"}])).is_err());
        let s = json!(serde_json::to_string(&json!([{"rule_type": "filename_pattern"}])).unwrap());
        assert_eq!(parse_rules(&s).unwrap().len(), 1);
    }

    #[test]
    fn filename_rule_groups_by_base() {
        let rule = &defaults()[2];
        let empty = ExifTags::new();
        let a = rule.is_burst_photo(&photo("d/IMG_20240301_120000_001.jpg", Some(0)), &empty);
        let b = rule.is_burst_photo(&photo("d/IMG_20240301_120000_002.jpg", Some(1)), &empty);
        assert!(a.0 && a.1.is_some());
        assert_eq!(a.1, b.1);
        let dir = Path::new("d/x.jpg").parent().unwrap().display().to_string();
        assert_eq!(a.1.unwrap(), format!("filename_{dir}_IMG_20240301_120000"));
        assert_eq!(
            rule.is_burst_photo(&photo("d/holiday.jpg", Some(0)), &empty),
            (false, None)
        );
        let cover = rule.is_burst_photo(&photo("d/pic_001_COVER.jpg", None), &empty);
        assert_eq!(cover.1.unwrap(), format!("filename_{dir}_pic_001"));
    }

    #[test]
    fn exif_rules() {
        let rules = defaults();
        let mut exif = ExifTags::new();
        exif.insert(BURST_MODE.into(), Some(json!(1)));
        exif.insert(CONTINUOUS_DRIVE.into(), None);
        let (hit, key) = rules[0].is_burst_photo(&photo("a.jpg", Some(0)), &exif);
        assert!(hit);
        assert!(key.unwrap().starts_with("burst_unknown_2023"));
        let mut seq = ExifTags::new();
        seq.insert(SEQUENCE_NUMBER.into(), Some(json!(0)));
        assert!(rules[1].is_burst_photo(&photo("a.jpg", Some(0)), &seq).0);
        assert_eq!(
            rules[1].is_burst_photo(&photo("a.jpg", None), &seq),
            (true, None)
        );
    }

    #[test]
    fn timestamp_groups() {
        let ps = [
            photo("a", Some(0)),
            photo("b", Some(1)),
            photo("c", Some(10)),
            photo("d", Some(11)),
        ];
        let refs: Vec<&BurstCandidate> = ps.iter().collect();
        assert_eq!(
            group_by_timestamp(&refs, 2000.0, true),
            vec![vec![0, 1], vec![2, 3]]
        );
        assert!(group_by_timestamp(&refs, 500.0, true).is_empty());
    }
}
