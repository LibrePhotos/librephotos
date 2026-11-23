//! Dashboards (`api/views/dataviz.py` over `api/stats.py`): `/api/stats/`,
//! `/api/photomonthcounts/`, `/api/wordcloud/`, `/api/socialgraph/`,
//! `/api/locationsunburst/`, `/api/locationtimeline/`.

use std::collections::{BTreeMap, HashMap, HashSet};

use axum::Json;
use axum::extract::State;
use chrono::{Datelike, NaiveDate, NaiveDateTime, Utc};
use indexmap::IndexMap;
use lp_auth::AuthUser;
use lp_core::extract::py_truthy;
use lp_core::{ApiResult, AppState};
use lp_db::stats_admin_stacks_dupes::stats as db;
use rand::seq::SliceRandom;
use serde::Serialize;
use serde_json::{Value, json};

use super::{layout, palette};

pub async fn count_stats(
    State(state): State<AppState>,
    user: AuthUser,
) -> ApiResult<Json<db::CountStats>> {
    Ok(Json(db::count_stats(&state.db, user.id).await?))
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct MonthCount {
    pub month: String,
    pub count: i64,
}

pub async fn photo_month_counts(
    State(state): State<AppState>,
    user: AuthUser,
) -> ApiResult<Json<Vec<MonthCount>>> {
    let rows = db::photo_month_counts(&state.db, user.id).await?;
    Ok(Json(month_histogram(&rows, Utc::now().year())))
}

/// `get_photo_month_counts`: every month from the first to the last one in
/// 2000..=this year, zero-filled, keyed `"YYYY-M"`.
pub fn month_histogram(rows: &[(NaiveDateTime, i64)], this_year: i32) -> Vec<MonthCount> {
    let in_range: Vec<NaiveDate> = rows
        .iter()
        .map(|(m, _)| m.date())
        .filter(|d| (2000..=this_year).contains(&d.year()))
        .collect();
    let (Some(first), Some(last)) = (in_range.iter().min(), in_range.iter().max()) else {
        return Vec::new();
    };
    let counts: HashMap<(i32, u32), i64> = rows
        .iter()
        .map(|(m, c)| ((m.year(), m.month()), *c))
        .collect();
    let mut out = Vec::new();
    let (mut y, mut m) = (first.year(), first.month());
    loop {
        out.push(MonthCount {
            month: format!("{y}-{m}"),
            count: counts.get(&(y, m)).copied().unwrap_or(0),
        });
        if (y, m) >= (last.year(), last.month()) {
            break;
        }
        if m == 12 {
            y += 1;
            m = 1;
        } else {
            m += 1;
        }
    }
    out
}

#[derive(Debug, Serialize, PartialEq)]
pub struct WordCloudEntry {
    pub label: String,
    pub y: f64,
}

#[derive(Debug, Serialize)]
pub struct WordCloud {
    pub captions: Vec<WordCloudEntry>,
    pub people: Vec<WordCloudEntry>,
    pub locations: Vec<WordCloudEntry>,
}

/// `_LabelTally`: counts plus the order labels were first seen in.
#[derive(Default)]
struct LabelTally {
    counts: IndexMap<String, i64>,
    first_seen: HashMap<String, usize>,
}

impl LabelTally {
    fn add(&mut self, label: String, order: &mut usize, first_seen: Option<usize>) {
        *self.counts.entry(label.clone()).or_insert(0) += 1;
        if let std::collections::hash_map::Entry::Vacant(e) = self.first_seen.entry(label) {
            e.insert(first_seen.unwrap_or(*order));
            *order += 1;
        }
    }

    fn top(&self, limit: usize) -> Vec<WordCloudEntry> {
        let mut items: Vec<(&String, i64)> = self.counts.iter().map(|(k, v)| (k, *v)).collect();
        items.sort_by_key(|(k, c)| (-c, self.first_seen.get(*k).copied().unwrap_or(1_000_000)));
        items
            .into_iter()
            .take(limit)
            .map(|(k, c)| WordCloudEntry {
                label: k.clone(),
                y: (c as f64).ln(),
            })
            .collect()
    }
}

/// Python `str()` of a JSON scalar.
pub fn py_str(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Bool(true) => "True".into(),
        Value::Bool(false) => "False".into(),
        Value::Null => "None".into(),
        Value::Number(n) => match n.as_i64().or_else(|| n.as_u64().map(|u| u as i64)) {
            Some(i) if n.is_i64() || n.is_u64() => i.to_string(),
            _ => format!("{:?}", n.as_f64().unwrap_or(0.0)),
        },
        other => other.to_string(),
    }
}

/// `_tag_labels`: the tagging model's `tags` list of one photo.
fn tag_labels(entry: Option<&Value>) -> Vec<String> {
    match entry.and_then(|e| e.get("tags")) {
        Some(Value::Array(tags)) => tags.iter().filter(|t| py_truthy(t)).map(py_str).collect(),
        _ => Vec::new(),
    }
}

/// `_location_texts`: feature texts except postcodes and POIs, deduplicated.
fn location_texts(features: &Value) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let Some(features) = features.as_array() else {
        return out;
    };
    for f in features.iter().filter_map(Value::as_object) {
        let Some(text) = f.get("text").filter(|t| py_truthy(t)) else {
            continue;
        };
        let skip = match f.get("place_type") {
            Some(Value::Array(types)) => types
                .iter()
                .any(|t| py_truthy(t) && matches!(t.as_str(), Some("postcode" | "poi"))),
            Some(t) => matches!(t.as_str(), Some("postcode" | "poi")),
            None => false,
        };
        let text = py_str(text);
        if !skip && !out.contains(&text) {
            out.push(text);
        }
    }
    out
}

pub async fn word_cloud(
    State(state): State<AppState>,
    user: AuthUser,
) -> ApiResult<Json<WordCloud>> {
    let model = state.settings().tagging_model.clone();
    let (captions, geo, people) = tokio::try_join!(
        db::caption_tag_entries(&state.db, user.id, &model),
        db::geo_features(&state.db, user.id),
        db::people_face_counts(&state.db, user.id),
    )?;
    let mut order = 0usize;
    let mut caption_tally = LabelTally::default();
    for entry in &captions {
        for label in tag_labels(entry.as_ref()) {
            caption_tally.add(label, &mut order, None);
        }
    }
    let mut location_tally = LabelTally::default();
    for features in &geo {
        for text in location_texts(features) {
            let seen = caption_tally.first_seen.get(&text).copied();
            location_tally.add(text, &mut order, seen);
        }
    }
    Ok(Json(WordCloud {
        captions: caption_tally.top(100),
        people: people
            .into_iter()
            .map(|(label, c)| WordCloudEntry {
                label,
                y: (c as f64).ln(),
            })
            .collect(),
        locations: location_tally.top(100),
    }))
}

#[derive(Debug, Serialize)]
pub struct GraphNode {
    pub id: String,
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Serialize)]
pub struct GraphLink {
    pub source: String,
    pub target: String,
}

#[derive(Debug, Serialize)]
pub struct SocialGraph {
    pub nodes: Vec<GraphNode>,
    pub links: Vec<GraphLink>,
}

fn node_slot<'a>(index: &mut IndexMap<&'a str, Vec<usize>>, name: &'a str) -> usize {
    match index.get_index_of(name) {
        Some(i) => i,
        None => index.insert_full(name, Vec::new()).0,
    }
}

/// `build_social_graph`: nodes in first-seen order, one link per unordered pair.
pub fn social_graph(links: &[(String, String)]) -> SocialGraph {
    let mut index: IndexMap<&str, Vec<usize>> = IndexMap::new();
    let mut linked: HashSet<(usize, usize)> = HashSet::new();
    for (a, b) in links {
        for (u, v) in [(a, b), (b, a)] {
            let ui = node_slot(&mut index, u);
            let vi = node_slot(&mut index, v);
            if linked.insert((ui, vi)) {
                index[ui].push(vi);
            }
        }
    }
    let mut edges: Vec<(usize, usize)> = Vec::new();
    let mut seen: HashSet<(usize, usize)> = HashSet::new();
    for (u, adj) in index.values().enumerate() {
        for &v in adj {
            if seen.insert((u.min(v), u.max(v))) {
                edges.push((u, v));
            }
        }
    }
    let names: Vec<&str> = index.keys().copied().collect();
    let pos = layout::spring_layout(names.len(), &edges, 0.5, 1000.0, 20);
    SocialGraph {
        nodes: names
            .iter()
            .zip(pos)
            .map(|(n, p)| GraphNode {
                id: n.to_string(),
                x: p[0],
                y: p[1],
            })
            .collect(),
        links: edges
            .iter()
            .map(|&(u, v)| GraphLink {
                source: names[u].to_string(),
                target: names[v].to_string(),
            })
            .collect(),
    }
}

pub async fn social_graph_view(
    State(state): State<AppState>,
    user: AuthUser,
) -> ApiResult<Json<SocialGraph>> {
    let links = db::social_links(&state.db, user.id).await?;
    let graph = state.blocking(move || social_graph(&links)).await?;
    Ok(Json(graph))
}

/// `get_location_sunburst`: country > region > place, counted, sorted.
pub fn location_sunburst(rows: &[Value], palette: &[String]) -> Value {
    let mut counter: BTreeMap<(String, String, String), i64> = BTreeMap::new();
    let mut texts: HashMap<(String, String, String), [Value; 3]> = HashMap::new();
    for features in rows {
        let Some(f) = features.as_array().filter(|f| f.len() >= 3) else {
            continue;
        };
        let text = |i: usize| {
            f[f.len() - i]
                .as_object()
                .and_then(|o| o.get("text"))
                .filter(|t| !t.is_null())
                .cloned()
        };
        let (Some(l1), Some(l2), Some(l3)) = (text(1), text(2), text(3)) else {
            continue;
        };
        let key = (py_str(&l1), py_str(&l2), py_str(&l3));
        *counter.entry(key.clone()).or_insert(0) += 1;
        texts.entry(key).or_insert([l1, l2, l3]);
    }
    let mut rng = rand::thread_rng();
    let mut pick = || Value::String(palette.choose(&mut rng).cloned().unwrap_or_default());
    let mut root: Vec<Value> = Vec::new();
    for (key, count) in &counter {
        let [l1, l2, l3] = texts[key].clone();
        let mut cursor = &mut root;
        for (depth, item) in [l1, l2].into_iter().enumerate() {
            // `item in c.values()`: the last child with any equal value.
            let idx = cursor.iter().rposition(|c| {
                c.as_object()
                    .is_some_and(|o| o.values().any(|v| *v == item))
            });
            let idx = match idx {
                Some(i) => i,
                None => {
                    cursor.push(json!({"name": item, "children": [], "hex": pick()}));
                    cursor.len() - 1
                }
            };
            let children = cursor[idx]
                .as_object_mut()
                .and_then(|o| o.get_mut("children"))
                .and_then(Value::as_array_mut);
            let Some(children) = children else { break };
            cursor = children;
            if depth == 1 {
                cursor.push(json!({"name": l3.clone(), "value": count, "hex": pick()}));
            }
        }
    }
    json!({"name": "Places I've visited", "children": root})
}

pub async fn location_sunburst_view(
    State(state): State<AppState>,
    user: AuthUser,
) -> ApiResult<Json<Value>> {
    let rows = db::geo_features(&state.db, user.id).await?;
    Ok(Json(location_sunburst(&rows, &palette::hls(10))))
}

#[derive(Debug, Serialize)]
pub struct TimelineSpan {
    pub data: [f64; 1],
    pub color: String,
    pub loc: Value,
    pub start: f64,
    pub end: f64,
}

/// `get_location_timeline`: runs of the same last-feature text, each ending
/// where the next begins.
pub fn location_timeline(rows: Vec<(Option<Value>, chrono::DateTime<Utc>)>) -> Vec<TimelineSpan> {
    let mut spans: Vec<(Value, chrono::DateTime<Utc>, chrono::DateTime<Utc>)> = Vec::new();
    for (loc, ts) in rows {
        let Some(loc) = loc.filter(|l| !l.is_null()) else {
            continue;
        };
        match spans.last_mut() {
            Some(last) if last.0 == loc => last.2 = ts,
            _ => spans.push((loc, ts, ts)),
        }
    }
    let colors = palette::paired(spans.len());
    let epoch = |t: &chrono::DateTime<Utc>| t.timestamp_micros() as f64 / 1e6;
    let begins: Vec<chrono::DateTime<Utc>> = spans.iter().map(|s| s.1).collect();
    spans
        .into_iter()
        .enumerate()
        .zip(colors)
        .map(|((i, (loc, begin, end)), color)| {
            let end = begins.get(i + 1).copied().unwrap_or(end);
            TimelineSpan {
                data: [(end - begin).num_microseconds().unwrap_or(0) as f64 / 1e6],
                color,
                loc,
                start: epoch(&begin),
                end: epoch(&end),
            }
        })
        .collect()
}

pub async fn location_timeline_view(
    State(state): State<AppState>,
    user: AuthUser,
) -> ApiResult<Json<Vec<TimelineSpan>>> {
    let rows = db::timeline_locations(&state.db, user.id).await?;
    Ok(Json(location_timeline(rows)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn histogram_fills_gaps() {
        let d = |y, m| {
            NaiveDate::from_ymd_opt(y, m, 1)
                .unwrap()
                .and_hms_opt(0, 0, 0)
                .unwrap()
        };
        let rows = vec![(d(2023, 11), 2), (d(2024, 2), 5), (d(1990, 1), 9)];
        let h = month_histogram(&rows, 2026);
        let months: Vec<&str> = h.iter().map(|m| m.month.as_str()).collect();
        assert_eq!(months, ["2023-11", "2023-12", "2024-1", "2024-2"]);
        assert_eq!(h[0].count, 2);
        assert_eq!(h[1].count, 0);
        assert!(month_histogram(&[(d(1990, 1), 1)], 2026).is_empty());
    }

    #[test]
    fn sunburst_nests_three_levels() {
        let f = |a: &str, b: &str, c: &str| json!([{"text": c}, {"text": b}, {"text": a}]);
        let rows = vec![
            f("DE", "Berlin", "Mitte"),
            f("DE", "Berlin", "Mitte"),
            f("DE", "Bayern", "München"),
        ];
        let tree = location_sunburst(&rows, &palette::hls(10));
        let de = &tree["children"][0];
        assert_eq!(de["name"], "DE");
        assert_eq!(de["children"][0]["name"], "Bayern");
        assert_eq!(
            de["children"][1]["children"][0],
            json!({"name": "Mitte", "value": 2, "hex": de["children"][1]["children"][0]["hex"]})
        );
    }

    #[test]
    fn graph_dedups_links() {
        let l = |a: &str, b: &str| (a.to_string(), b.to_string());
        let g = social_graph(&[l("A", "B"), l("B", "A"), l("A", "C"), l("C", "A")]);
        assert_eq!(
            g.nodes.iter().map(|n| n.id.as_str()).collect::<Vec<_>>(),
            ["A", "B", "C"]
        );
        assert_eq!(g.links.len(), 2);
    }
}
