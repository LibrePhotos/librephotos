//! `api/date_time_extractor.py`: the owner's datetime rules, applied in
//! order until one yields a local time (stored labelled as UTC).

use std::collections::HashMap;
use std::path::Path;
use std::sync::OnceLock;

use chrono::{DateTime, NaiveDate, NaiveDateTime, Offset, TimeZone, Utc};
use chrono_tz::Tz;
use fancy_regex::Regex;
use serde_json::Value;

use crate::pyfmt;

fn group_range(a: u32, b: u32) -> String {
    let alts: Vec<String> = (a..b).map(|i| format!("{i:02}")).collect();
    format!("({})", alts.join("|"))
}

fn regexp_no_tz() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| {
        let delim = r"[-:_\., ]*";
        let parts = [
            r"((?:19|20|21)\d\d)".to_string(),
            group_range(1, 13),
            group_range(1, 32),
            group_range(0, 24),
            r"([0-5]\d)".to_string(),
            r"([0-5]\d)".to_string(),
        ];
        Regex::new(&format!(r"(?<!\d){}", parts.join(delim))).expect("static regex")
    })
}

fn regexp_whatsapp() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| {
        Regex::new(r"^(?:IMG|VID)[-_](\d{4})(\d{2})(\d{2})(?:[-_]WA(\d+))?").expect("static regex")
    })
}

const WHATSAPP_MAPPING: &[&str] = &["year", "month", "day", "microsecond"];

fn mapping_index(name: &str) -> Option<usize> {
    Some(match name {
        "year" => 0,
        "month" => 1,
        "day" => 2,
        "hour" => 3,
        "minute" => 4,
        "second" => 5,
        "microsecond" => 6,
        _ => return None,
    })
}

/// `datetime(*args)` with Python's validation; microsecond < 1e6.
fn make_datetime(a: &[Option<i64>; 7]) -> Option<NaiveDateTime> {
    let y = a[0]?;
    let mo = a[1]?;
    let d = a[2]?;
    let (h, mi, s, us) = (a[3]?, a[4]?, a[5]?, a[6]?);
    if !(1..=9999).contains(&y) || !(0..1_000_000).contains(&us) {
        return None;
    }
    NaiveDate::from_ymd_opt(y as i32, mo.try_into().ok()?, d.try_into().ok()?)?.and_hms_micro_opt(
        h.try_into().ok()?,
        mi.try_into().ok()?,
        s.try_into().ok()?,
        us as u32,
    )
}

/// `_extract_no_tz_datetime_from_str`.
fn extract_no_tz(
    x: &str,
    regexp: &Regex,
    mapping: Option<&[&str]>,
) -> Result<Option<NaiveDateTime>, String> {
    let caps = match regexp.captures(x) {
        Ok(Some(c)) => c,
        _ => return Ok(None),
    };
    let groups: Vec<Option<&str>> = (1..caps.len())
        .map(|i| caps.get(i).map(|m| m.as_str()))
        .collect();
    let mut args: [Option<i64>; 7] = [None, None, None, Some(0), Some(0), Some(0), Some(0)];
    match mapping {
        None => {
            // datetime(*map(int, groups)): exactly the captured groups.
            if groups.len() < 3 || groups.len() > 7 {
                return Ok(None);
            }
            let mut vals = Vec::new();
            for g in &groups {
                match g.and_then(|s| s.parse::<i64>().ok()) {
                    Some(v) => vals.push(v),
                    None => return Ok(None),
                }
            }
            for (i, v) in vals.into_iter().enumerate() {
                args[i] = Some(v);
            }
        }
        Some(map) => {
            if groups.len() > map.len() {
                return Err(format!(
                    "Can't have more groups than group mapping values: {x}"
                ));
            }
            for (g, how) in groups.iter().zip(map.iter()) {
                let ind =
                    mapping_index(how).ok_or_else(|| format!("Group mapping {how} is unknown"))?;
                if let Some(v) = g.and_then(|s| s.parse::<i64>().ok()) {
                    args[ind] = Some(v);
                }
            }
        }
    }
    let Some(parsed) = make_datetime(&args) else {
        return Ok(None);
    };
    let delta = parsed - chrono::Local::now().naive_local();
    // timedelta.days is floor division.
    if delta.num_seconds().div_euclid(86_400) > 30 {
        return Ok(None);
    }
    Ok(Some(parsed))
}

#[derive(Debug, Clone)]
pub struct Rule {
    pub params: serde_json::Map<String, Value>,
}

/// The tz a rule description names: None = "server local"; Err = not applicable.
enum Zone {
    Utc,
    Local,
    Named(Tz),
}

impl Rule {
    fn s(&self, k: &str) -> Option<&str> {
        self.params.get(k).and_then(Value::as_str)
    }

    fn rule_type(&self) -> &str {
        self.s("rule_type").unwrap_or("")
    }

    fn condition_exif(&self) -> Option<(String, String)> {
        let v = self.s("condition_exif")?;
        let (t, p) = v.split_once("//")?;
        Some((t.to_string(), p.to_string()))
    }

    pub fn required_tags(&self) -> Vec<String> {
        let mut out = Vec::new();
        if let Some((t, _)) = self.condition_exif() {
            out.push(t);
        }
        if self.rule_type() == "exif"
            && let Some(t) = self.s("exif_tag")
        {
            out.push(t.to_string());
        }
        out
    }

    fn check_conditions(&self, path: &str, exif: &HashMap<String, Option<Value>>) -> bool {
        if let Some((tag, pattern)) = self.condition_exif() {
            let Some(Some(v)) = exif.get(&tag) else {
                return false;
            };
            if !pyfmt::truthy(v) {
                return false;
            }
            if !re_search(&pattern, &pyfmt::value_str(v)) {
                return false;
            }
        }
        if let Some(p) = self.s("condition_path")
            && !re_search(p, path)
        {
            return false;
        }
        if let Some(p) = self.s("condition_filename")
            && !re_search(p, file_name(path))
        {
            return false;
        }
        true
    }

    fn zone(&self, desc: &str, ctx: &Inputs<'_>) -> Option<Zone> {
        match desc {
            "gps_timezonefinder" => gps_tz(ctx.gps_lat, ctx.gps_lon).map(Zone::Named),
            "user_default" => ctx.user_default_tz.parse::<Tz>().ok().map(Zone::Named),
            "server_local" => Some(Zone::Local),
            d if d.eq_ignore_ascii_case("utc") => Some(Zone::Utc),
            d if d.starts_with("name:") => d[5..].parse::<Tz>().ok().map(Zone::Named),
            _ => None,
        }
    }

    fn transform(&self, dt: Option<NaiveDateTime>, ctx: &Inputs<'_>) -> Option<DateTime<Utc>> {
        let dt = dt?;
        let transform = self.params.get("transform_tz").is_some_and(pyfmt::truthy);
        if !transform {
            return Some(dt.and_utc());
        }
        let source = self.zone(self.s("source_tz")?, ctx)?;
        let report = self.zone(self.s("report_tz")?, ctx)?;
        // dt.replace(tzinfo=source).timestamp(): pytz zones attach their
        // first (LMT) offset here, which is what Django computes.
        let ts = match source {
            Zone::Utc => dt.and_utc().timestamp_micros(),
            Zone::Local => chrono::Local
                .from_local_datetime(&dt)
                .earliest()?
                .timestamp_micros(),
            Zone::Named(tz) => {
                let off = lmt_offset_secs(tz);
                dt.and_utc().timestamp_micros() - off * 1_000_000
            }
        };
        let utc = DateTime::<Utc>::from_timestamp_micros(ts)?;
        let local = match report {
            Zone::Utc => utc.naive_utc(),
            Zone::Local => utc.with_timezone(&chrono::Local).naive_local(),
            Zone::Named(tz) => utc.with_timezone(&tz).naive_local(),
        };
        Some(local.and_utc())
    }

    pub fn apply(
        &self,
        path: &str,
        exif: &HashMap<String, Option<Value>>,
        ctx: &Inputs<'_>,
    ) -> Option<DateTime<Utc>> {
        if !self.check_conditions(path, exif) {
            return None;
        }
        match self.rule_type() {
            "exif" => {
                let tag = self.s("exif_tag")?;
                let v = exif.get(tag)?.as_ref()?;
                if !pyfmt::truthy(v) {
                    return None;
                }
                let dt = extract_no_tz(&pyfmt::value_str(v), regexp_no_tz(), None).ok()?;
                self.transform(dt, ctx)
            }
            "path" => {
                let source = match self.s("path_part") {
                    None | Some("filename") => file_name(path),
                    Some("full_path") => path,
                    Some(_) => return None,
                };
                let dt = if let Some(custom) = self.s("custom_regexp").filter(|s| !s.is_empty()) {
                    let re = Regex::new(custom).ok()?;
                    extract_no_tz(source, &re, None).ok()?
                } else {
                    match self.s("predefined_regexp").unwrap_or("default") {
                        "default" => extract_no_tz(source, regexp_no_tz(), None).ok()?,
                        "whatsapp" => {
                            extract_no_tz(source, regexp_whatsapp(), Some(WHATSAPP_MAPPING)).ok()?
                        }
                        _ => return None,
                    }
                };
                self.transform(dt, ctx)
            }
            "filesystem" => {
                let meta = std::fs::metadata(path).ok()?;
                let t = match self.s("file_property") {
                    Some("mtime") => meta.modified().ok()?,
                    // os.path.getctime is the creation time on Windows.
                    Some("ctime") => meta.created().or_else(|_| meta.modified()).ok()?,
                    _ => return None,
                };
                let utc: DateTime<Utc> = t.into();
                self.transform(Some(utc.naive_utc()), ctx)
            }
            "user_defined" => ctx.user_defined_timestamp,
            _ => None,
        }
    }
}

/// pytz's default tzinfo of a zone is its first entry (usually LMT), whose
/// offset pytz rounds to whole minutes.
fn lmt_offset_secs(tz: Tz) -> i64 {
    let early = NaiveDate::from_ymd_opt(1800, 1, 1)
        .and_then(|d| d.and_hms_opt(0, 0, 0))
        .expect("valid date");
    let secs = tz.offset_from_utc_datetime(&early).fix().local_minus_utc() as i64;
    ((secs + 30).div_euclid(60)) * 60
}

fn file_name(path: &str) -> &str {
    path.rsplit(['/', '\\']).next().unwrap_or(path)
}

fn re_search(pattern: &str, text: &str) -> bool {
    Regex::new(pattern)
        .ok()
        .and_then(|r| r.is_match(text).ok())
        .unwrap_or(false)
}

fn gps_ok(lat: Option<f64>, lon: Option<f64>) -> Option<(f64, f64)> {
    let (lat, lon) = (lat?, lon?);
    if lat.is_finite() && lon.is_finite() && (lat != 0.0 || lon != 0.0) {
        Some((lat, lon))
    } else {
        None
    }
}

fn gps_tz(lat: Option<f64>, lon: Option<f64>) -> Option<Tz> {
    static FINDER: OnceLock<tzf_rs::DefaultFinder> = OnceLock::new();
    let (lat, lon) = gps_ok(lat, lon)?;
    let name = FINDER
        .get_or_init(tzf_rs::DefaultFinder::new)
        .get_tz_name(lon, lat);
    if name.is_empty() {
        return None;
    }
    name.parse::<Tz>().ok()
}

pub struct Inputs<'a> {
    pub gps_lat: Option<f64>,
    pub gps_lon: Option<f64>,
    pub user_default_tz: &'a str,
    pub user_defined_timestamp: Option<DateTime<Utc>>,
}

/// The owner's rules from `api_user.datetime_rules` (a JSON string holding
/// the list, or the list itself).
pub fn rules_from_user(value: &Value) -> Vec<Rule> {
    let list = match value {
        Value::String(s) => serde_json::from_str::<Value>(s).unwrap_or(Value::Null),
        other => other.clone(),
    };
    list.as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|v| v.as_object().cloned())
                .map(|params| Rule { params })
                .collect()
        })
        .unwrap_or_default()
}

pub fn required_tags(rules: &[Rule]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for r in rules {
        for t in r.required_tags() {
            if !out.contains(&t) {
                out.push(t);
            }
        }
    }
    out
}

/// `extract_local_date_time`.
pub fn extract_local_date_time(
    path: &Path,
    rules: &[Rule],
    exif: &HashMap<String, Option<Value>>,
    ctx: &Inputs<'_>,
) -> Option<DateTime<Utc>> {
    let p = path.to_string_lossy();
    rules.iter().find_map(|r| r.apply(&p, exif, ctx))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Timelike;
    use serde_json::json;

    fn ctx() -> Inputs<'static> {
        Inputs {
            gps_lat: None,
            gps_lon: None,
            user_default_tz: "UTC",
            user_defined_timestamp: None,
        }
    }

    #[test]
    fn default_regexp() {
        let dt = extract_no_tz("2024:05:12 10:00:00", regexp_no_tz(), None)
            .unwrap()
            .unwrap();
        assert_eq!(dt.to_string(), "2024-05-12 10:00:00");
        let dt = extract_no_tz("Screenshot_20240115-093000.png", regexp_no_tz(), None)
            .unwrap()
            .unwrap();
        assert_eq!(dt.to_string(), "2024-01-15 09:30:00");
        assert!(
            extract_no_tz("12024:05:12 10:00:00x", regexp_no_tz(), None)
                .unwrap()
                .is_none()
        );
        assert!(
            extract_no_tz("nothing", regexp_no_tz(), None)
                .unwrap()
                .is_none()
        );
        assert!(
            extract_no_tz("2999:01:01 00:00:00", regexp_no_tz(), None)
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn whatsapp() {
        let dt = extract_no_tz(
            "IMG-20220101-WA0007.jpg",
            regexp_whatsapp(),
            Some(WHATSAPP_MAPPING),
        )
        .unwrap()
        .unwrap();
        assert_eq!(dt.date().to_string(), "2022-01-01");
        assert_eq!(dt.nanosecond(), 7_000);
    }

    #[test]
    fn rules_in_order() {
        let rules = rules_from_user(&json!(
            "[{\"rule_type\": \"user_defined\"}, {\"rule_type\": \"exif\", \"exif_tag\": \"EXIF:DateTimeOriginal\"}, {\"rule_type\": \"path\"}]"
        ));
        assert_eq!(
            required_tags(&rules),
            vec!["EXIF:DateTimeOriginal".to_string()]
        );
        let mut exif = HashMap::new();
        exif.insert(
            "EXIF:DateTimeOriginal".to_string(),
            Some(json!("2021:04:01 12:00:00")),
        );
        let got = extract_local_date_time(
            Path::new(r"C:\x\IMG_20200101_101010.jpg"),
            &rules,
            &exif,
            &ctx(),
        );
        assert_eq!(got.unwrap().to_rfc3339(), "2021-04-01T12:00:00+00:00");
        exif.insert("EXIF:DateTimeOriginal".to_string(), None);
        let got = extract_local_date_time(
            Path::new(r"C:\x\IMG_20200101_101010.jpg"),
            &rules,
            &exif,
            &ctx(),
        );
        assert_eq!(got.unwrap().to_rfc3339(), "2020-01-01T10:10:10+00:00");
    }

    #[test]
    fn utc_to_named_zone() {
        let rule = Rule {
            params:
                json!({"rule_type": "exif", "exif_tag": "QuickTime:CreateDate", "transform_tz": 1,
                           "source_tz": "utc", "report_tz": "name:Europe/Berlin"})
                .as_object()
                .unwrap()
                .clone(),
        };
        let mut exif = HashMap::new();
        exif.insert(
            "QuickTime:CreateDate".to_string(),
            Some(json!("2024:05:12 12:00:00")),
        );
        let got = rule.apply("x.mp4", &exif, &ctx()).unwrap();
        assert_eq!(got.to_rfc3339(), "2024-05-12T14:00:00+00:00");
    }
}
