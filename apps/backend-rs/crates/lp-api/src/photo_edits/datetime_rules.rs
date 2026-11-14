//! Port of `api/date_time_extractor.py`: the owner's datetime rules, applied
//! in order until one yields a capture time. The result is local time
//! labelled UTC, as Django stores it.
//!
//! EXIF tags are read lazily (all tags the rules need, in one read) the
//! first time a rule needs them, so the usual "Timestamp set by user" first
//! rule never touches the file.

use std::future::Future;
use std::sync::LazyLock;

use chrono::{DateTime, NaiveDate, NaiveDateTime, TimeZone, Utc};
use chrono_tz::Tz;
use fancy_regex::Regex;
use serde_json::{Map, Value};

fn group_range(a: u32, b: u32) -> String {
    format!(
        "({})",
        (a..b)
            .map(|i| format!("{i:02}"))
            .collect::<Vec<_>>()
            .join("|")
    )
}

static REGEXP_NO_TZ: LazyLock<Regex> = LazyLock::new(|| {
    let delim = r"[-:_\., ]*";
    let parts = [
        r"((?:19|20|21)\d\d)".to_string(),
        group_range(1, 13),
        group_range(1, 32),
        group_range(0, 24),
        r"([0-5]\d)".to_string(),
        r"([0-5]\d)".to_string(),
    ];
    Regex::new(&format!(r"(?<!\d){}", parts.join(delim))).expect("default datetime regexp")
});

static REGEXP_WHATSAPP: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^(?:IMG|VID)[-_](\d{4})(\d{2})(\d{2})(?:[-_]WA(\d+))?").expect("whatsapp regexp")
});

const WHATSAPP_MAPPING: [&str; 4] = ["year", "month", "day", "microsecond"];

static TZ_FINDER: LazyLock<tzf_rs::DefaultFinder> = LazyLock::new(tzf_rs::DefaultFinder::new);

/// Everything a rule may look at besides EXIF tags.
pub struct RuleInput<'a> {
    pub path: &'a str,
    pub gps_lat: Option<f64>,
    pub gps_lon: Option<f64>,
    pub user_default_tz: &'a str,
    pub user_defined: Option<DateTime<Utc>>,
}

/// `json.loads(user.datetime_rules)`: stored double-encoded by Django.
pub fn parse_rules(stored: &Value) -> Vec<Map<String, Value>> {
    let decoded = match stored {
        Value::String(s) => serde_json::from_str::<Value>(s).unwrap_or(Value::Null),
        other => other.clone(),
    };
    match decoded {
        Value::Array(items) => items
            .into_iter()
            .filter_map(|v| match v {
                Value::Object(m) => Some(m),
                _ => None,
            })
            .collect(),
        _ => Vec::new(),
    }
}

fn param<'a>(rule: &'a Map<String, Value>, key: &str) -> Option<&'a str> {
    rule.get(key).and_then(Value::as_str)
}

fn condition_exif(rule: &Map<String, Value>) -> Option<(String, String)> {
    let raw = param(rule, "condition_exif")?;
    raw.split_once("//")
        .map(|(t, p)| (t.to_string(), p.to_string()))
}

fn needs_exif(rule: &Map<String, Value>) -> bool {
    condition_exif(rule).is_some() || param(rule, "rule_type") == Some("exif")
}

/// `get_required_exif_tags` over every rule, deduplicated, in first-seen order.
pub fn required_tags(rules: &[Map<String, Value>]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for rule in rules {
        let mut push = |t: String| {
            if !out.contains(&t) {
                out.push(t);
            }
        };
        if let Some((tag, _)) = condition_exif(rule) {
            push(tag);
        }
        if param(rule, "rule_type") == Some("exif")
            && let Some(tag) = param(rule, "exif_tag")
        {
            push(tag.to_string());
        }
    }
    out
}

fn py_str(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Bool(true) => "True".into(),
        Value::Bool(false) => "False".into(),
        other => other.to_string(),
    }
}

fn file_name(path: &str) -> &str {
    path.rsplit(['/', '\\']).next().unwrap_or(path)
}

/// `_extract_no_tz_datetime_from_str`.
pub fn extract_no_tz(x: &str, re: &Regex, mapping: Option<&[&str]>) -> Option<NaiveDateTime> {
    let caps = re.captures(x).ok()??;
    let groups: Vec<Option<&str>> = (1..caps.len())
        .map(|i| caps.get(i).map(|m| m.as_str()))
        .collect();
    // year, month, day, hour, minute, second, microsecond
    let mut args: [Option<i64>; 7] = [None, None, None, Some(0), Some(0), Some(0), Some(0)];
    match mapping {
        None => {
            for (i, g) in groups.iter().enumerate().take(7) {
                args[i] = Some(g.and_then(|s| s.parse().ok())?);
            }
            if groups.len() < 3 {
                return None;
            }
        }
        Some(mapping) => {
            if groups.len() > mapping.len() {
                return None;
            }
            for (g, how) in groups.iter().zip(mapping) {
                let idx = match *how {
                    "year" => 0,
                    "month" => 1,
                    "day" => 2,
                    "hour" => 3,
                    "minute" => 4,
                    "second" => 5,
                    "microsecond" => 6,
                    _ => return None,
                };
                if let Some(v) = g {
                    args[idx] = Some(v.parse().ok()?);
                }
            }
        }
    }
    let get = |i: usize| args[i].and_then(|v| u32::try_from(v).ok());
    let date = NaiveDate::from_ymd_opt(i32::try_from(args[0]?).ok()?, get(1)?, get(2)?)?;
    let micro = get(6)?;
    if micro > 999_999 {
        return None;
    }
    let dt = date.and_hms_micro_opt(get(3)?, get(4)?, get(5)?, micro)?;
    if (dt - Utc::now().naive_utc()).num_days() > 30 {
        return None;
    }
    Some(dt)
}

enum ZoneSpec {
    Utc,
    Named(Tz),
    ServerLocal,
}

fn gps_ok(lat: Option<f64>, lon: Option<f64>) -> Option<(f64, f64)> {
    match (lat, lon) {
        (Some(la), Some(lo)) if la.is_finite() && lo.is_finite() && (la != 0.0 || lo != 0.0) => {
            Some((la, lo))
        }
        _ => None,
    }
}

fn get_tz(description: &str, input: &RuleInput<'_>) -> Option<ZoneSpec> {
    match description {
        "gps_timezonefinder" => {
            let (lat, lon) = gps_ok(input.gps_lat, input.gps_lon)?;
            let name = TZ_FINDER.get_tz_name(lon, lat);
            name.parse::<Tz>().ok().map(ZoneSpec::Named)
        }
        "user_default" => input
            .user_default_tz
            .parse::<Tz>()
            .ok()
            .map(ZoneSpec::Named),
        "server_local" => Some(ZoneSpec::ServerLocal),
        d if d.eq_ignore_ascii_case("utc") => Some(ZoneSpec::Utc),
        d => d
            .strip_prefix("name:")?
            .parse::<Tz>()
            .ok()
            .map(ZoneSpec::Named),
    }
}

/// `_transform_tz`: reinterpret `dt` from `source_tz` into `report_tz`
/// local time, labelled UTC. The server's local zone is taken to be UTC.
fn transform_tz(
    rule: &Map<String, Value>,
    dt: NaiveDateTime,
    input: &RuleInput<'_>,
) -> Option<DateTime<Utc>> {
    let wants = rule
        .get("transform_tz")
        .is_some_and(lp_core::extract::py_truthy);
    if !wants {
        return Some(dt.and_utc());
    }
    let source = get_tz(param(rule, "source_tz")?, input)?;
    let report = get_tz(param(rule, "report_tz")?, input)?;
    let instant: DateTime<Utc> = match source {
        ZoneSpec::Utc | ZoneSpec::ServerLocal => dt.and_utc(),
        ZoneSpec::Named(tz) => tz.from_local_datetime(&dt).earliest()?.with_timezone(&Utc),
    };
    let local = match report {
        ZoneSpec::Utc | ZoneSpec::ServerLocal => instant.naive_utc(),
        ZoneSpec::Named(tz) => instant.with_timezone(&tz).naive_local(),
    };
    Some(local.and_utc())
}

fn check_conditions(
    rule: &Map<String, Value>,
    path: &str,
    tags: &[(String, Option<Value>)],
) -> bool {
    if let Some((tag, pattern)) = condition_exif(rule) {
        let value = tags
            .iter()
            .find(|(t, _)| *t == tag)
            .and_then(|(_, v)| v.as_ref());
        let Some(v) = value.filter(|v| lp_core::extract::py_truthy(v)) else {
            return false;
        };
        if !Regex::new(&pattern).is_ok_and(|re| re.is_match(&py_str(v)).unwrap_or(false)) {
            return false;
        }
    }
    if let Some(p) = param(rule, "condition_path")
        && !Regex::new(p).is_ok_and(|re| re.is_match(path).unwrap_or(false))
    {
        return false;
    }
    if let Some(p) = param(rule, "condition_filename")
        && !Regex::new(p).is_ok_and(|re| re.is_match(file_name(path)).unwrap_or(false))
    {
        return false;
    }
    true
}

fn file_time(path: &str, property: &str) -> Option<NaiveDateTime> {
    let meta = std::fs::metadata(path).ok()?;
    let t = match property {
        "mtime" => meta.modified().ok()?,
        "ctime" => meta.created().or_else(|_| meta.modified()).ok()?,
        _ => return None,
    };
    Some(DateTime::<Utc>::from(t).naive_utc())
}

fn apply(
    rule: &Map<String, Value>,
    input: &RuleInput<'_>,
    tags: &[(String, Option<Value>)],
) -> Option<DateTime<Utc>> {
    if !check_conditions(rule, input.path, tags) {
        return None;
    }
    match param(rule, "rule_type")? {
        "user_defined" => input.user_defined,
        "exif" => {
            let tag = param(rule, "exif_tag")?;
            let value = tags
                .iter()
                .find(|(t, _)| t == tag)
                .and_then(|(_, v)| v.as_ref())?;
            if !lp_core::extract::py_truthy(value) {
                return None;
            }
            let dt = extract_no_tz(&py_str(value), &REGEXP_NO_TZ, None)?;
            transform_tz(rule, dt, input)
        }
        "path" => {
            let source = match param(rule, "path_part") {
                None | Some("filename") => file_name(input.path),
                Some("full_path") => input.path,
                Some(_) => return None,
            };
            let custom = param(rule, "custom_regexp").filter(|s| !s.is_empty());
            let dt = match custom {
                Some(re) => extract_no_tz(source, &Regex::new(re).ok()?, None)?,
                None => match param(rule, "predefined_regexp").unwrap_or("default") {
                    "default" => extract_no_tz(source, &REGEXP_NO_TZ, None)?,
                    "whatsapp" => extract_no_tz(source, &REGEXP_WHATSAPP, Some(&WHATSAPP_MAPPING))?,
                    _ => return None,
                },
            };
            transform_tz(rule, dt, input)
        }
        "filesystem" => {
            let dt = file_time(input.path, param(rule, "file_property")?)?;
            transform_tz(rule, dt, input)
        }
        _ => None,
    }
}

/// `extract_local_date_time`. `read_tags` reads the given EXIF tags (with
/// sidecars) and is called at most once.
pub async fn extract_local_date_time<F, Fut>(
    rules: &[Map<String, Value>],
    input: &RuleInput<'_>,
    read_tags: F,
) -> anyhow::Result<Option<DateTime<Utc>>>
where
    F: FnOnce(Vec<String>) -> Fut,
    Fut: Future<Output = anyhow::Result<Vec<Option<Value>>>>,
{
    let mut reader = Some(read_tags);
    let mut tags: Vec<(String, Option<Value>)> = Vec::new();
    for rule in rules {
        if needs_exif(rule)
            && let Some(read) = reader.take()
        {
            let wanted = required_tags(rules);
            let values = read(wanted.clone()).await?;
            tags = wanted.into_iter().zip(values).collect();
        }
        if let Some(dt) = apply(rule, input, &tags) {
            return Ok(Some(dt));
        }
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn input(path: &str) -> RuleInput<'_> {
        RuleInput {
            path,
            gps_lat: None,
            gps_lon: None,
            user_default_tz: "Europe/Berlin",
            user_defined: None,
        }
    }

    #[test]
    fn default_regexp() {
        let dt = extract_no_tz("IMG_20240301_120000_001.jpg", &REGEXP_NO_TZ, None).unwrap();
        assert_eq!(dt.to_string(), "2024-03-01 12:00:00");
        assert!(extract_no_tz("x2024:03:01 12:00:00", &REGEXP_NO_TZ, None).is_some());
        assert!(extract_no_tz("12024:03:01 12:00:00", &REGEXP_NO_TZ, None).is_none());
        assert!(extract_no_tz("2024:02:30 12:00:00", &REGEXP_NO_TZ, None).is_none());
    }

    #[test]
    fn whatsapp() {
        let dt = extract_no_tz(
            "IMG-20220101-WA0007.jpg",
            &REGEXP_WHATSAPP,
            Some(&WHATSAPP_MAPPING),
        )
        .unwrap();
        assert_eq!(dt.to_string(), "2022-01-01 00:00:00.000007");
    }

    #[tokio::test]
    async fn first_matching_rule_wins_and_exif_is_lazy() {
        let rules = parse_rules(&json!(
            "[{\"rule_type\": \"user_defined\"}, {\"rule_type\": \"exif\", \"exif_tag\": \"EXIF:DateTimeOriginal\"}, {\"rule_type\": \"path\"}]"
        ));
        let mut inp = input("C:\\x\\IMG_20240301_120000.jpg");
        let ts = Utc.with_ymd_and_hms(2020, 1, 2, 3, 4, 5).unwrap();
        inp.user_defined = Some(ts);
        let got = extract_local_date_time(&rules, &inp, |_| async { panic!("no exif read") })
            .await
            .unwrap();
        assert_eq!(got, Some(ts));

        inp.user_defined = None;
        let got = extract_local_date_time(&rules, &inp, |tags| async move {
            assert_eq!(tags, vec!["EXIF:DateTimeOriginal".to_string()]);
            Ok(vec![Some(json!("2019:05:06 07:08:09"))])
        })
        .await
        .unwrap();
        assert_eq!(got.unwrap().to_string(), "2019-05-06 07:08:09 UTC");

        let got = extract_local_date_time(&rules, &inp, |_| async { Ok(vec![None]) })
            .await
            .unwrap();
        assert_eq!(got.unwrap().to_string(), "2024-03-01 12:00:00 UTC");
    }

    #[test]
    fn transform_to_user_zone() {
        let rule = json!({"rule_type": "exif", "exif_tag": "QuickTime:CreateDate", "transform_tz": 1,
                          "source_tz": "utc", "report_tz": "user_default"});
        let tags = vec![(
            "QuickTime:CreateDate".to_string(),
            Some(json!("2021:07:01 10:00:00")),
        )];
        let got = apply(rule.as_object().unwrap(), &input("x.mp4"), &tags).unwrap();
        assert_eq!(got.to_string(), "2021-07-01 12:00:00 UTC");
    }

    #[test]
    fn gps_zone() {
        let rule = json!({"rule_type": "exif", "exif_tag": "Composite:GPSDateTime", "transform_tz": 1,
                          "source_tz": "utc", "report_tz": "gps_timezonefinder"});
        let tags = vec![(
            "Composite:GPSDateTime".to_string(),
            Some(json!("2021:01:01 10:00:00Z")),
        )];
        let mut inp = input("x.jpg");
        assert!(apply(rule.as_object().unwrap(), &inp, &tags).is_none());
        inp.gps_lat = Some(35.68);
        inp.gps_lon = Some(139.69);
        let got = apply(rule.as_object().unwrap(), &inp, &tags).unwrap();
        assert_eq!(got.to_string(), "2021-01-01 19:00:00 UTC");
    }
}
