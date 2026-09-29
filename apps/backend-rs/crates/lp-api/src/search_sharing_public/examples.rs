//! `GET /api/searchtermexamples/` (api/views/search.py `SearchTermExamples` +
//! api/api_util.py `get_search_term_examples`): random example searches built
//! from the caller's captioned photos, cached per user for two hours.

use std::sync::{Arc, LazyLock};
use std::time::{Duration, Instant};

use super::auth::ApiUser;
use axum::Json;
use axum::extract::State;
use chrono::Datelike;
use dashmap::DashMap;
use lp_core::{ApiResult, AppState};
use lp_db::search_sharing_public::examples::{self, ExampleSample};
use rand::Rng;
use rand::seq::SliceRandom;
use serde_json::Value;

use super::search::Results;

const CACHE_TTL: Duration = Duration::from_secs(60 * 60 * 2);

const DEFAULT_TERMS: [&str; 5] = [
    "for people",
    "for places",
    "for things",
    "for time",
    "for file path or file name",
];

/// Keyed by (database, user): test processes run several databases at once.
type Cache = DashMap<(String, i32), (Instant, Arc<Vec<String>>)>;
static CACHE: LazyLock<Cache> = LazyLock::new(DashMap::new);

pub(super) async fn search_term_examples(
    State(state): State<AppState>,
    ApiUser(user): ApiUser,
) -> ApiResult<Json<Results<Arc<Vec<String>>>>> {
    let key = (state.config.db.name.clone(), user.id);
    if let Some(hit) = CACHE.get(&key)
        && hit.0.elapsed() < CACHE_TTL
    {
        return Ok(Json(Results {
            results: hit.1.clone(),
        }));
    }
    let samples = examples::samples(&state.db, user.id).await?;
    let tagging_model = state.settings().tagging_model.clone();
    let terms = Arc::new(build_terms(
        &samples,
        &tagging_model,
        &mut rand::thread_rng(),
    ));
    CACHE.insert(key, (Instant::now(), terms.clone()));
    Ok(Json(Results { results: terms }))
}

/// The four term sources of one photo.
#[derive(Default)]
struct Datum {
    loc: Vec<String>,
    time: Vec<String>,
    people: Vec<String>,
    things: Vec<String>,
}

fn is_py_digit(s: &str) -> bool {
    !s.is_empty() && s.chars().all(|c| c.is_numeric())
}

fn datum(p: &ExampleSample, tagging_model: &str) -> Datum {
    let mut d = Datum::default();
    if let Some(Value::Object(geo)) = p.geolocation_json.as_ref().map(|j| &j.0)
        && let Some(Value::Array(features)) = geo.get("features")
    {
        let tail = &features[features.len().saturating_sub(5)..];
        d.loc = tail
            .iter()
            .filter_map(|f| f.get("text").and_then(Value::as_str))
            .filter(|t| !is_py_digit(t))
            .map(str::to_string)
            .collect();
    }
    if let Some(ts) = p.exif_timestamp {
        d.time = vec![ts.year().to_string()];
    }
    d.people = p
        .face_names
        .iter()
        .map(|n| {
            n.as_deref()
                .map(|n| n.split(' ').next().unwrap_or("").to_string())
                .unwrap_or_default()
        })
        .collect();
    if let Some(Value::Object(captions)) = p.captions_json.as_ref().map(|j| &j.0)
        && let Some(Value::Object(tags)) = captions.get(tagging_model)
        && let Some(Value::Array(tags)) = tags.get("tags")
    {
        d.things = tags
            .iter()
            .filter_map(Value::as_str)
            .map(str::to_string)
            .collect();
    }
    d
}

fn joined<R: Rng>(rng: &mut R, parts: &[&str]) -> String {
    let mut parts = parts.to_vec();
    parts.shuffle(rng);
    parts.join(" ")
}

/// The random draw of `get_search_term_examples`, over every sample at once
/// (Django rebuilds the list per sample but only the last pass survives).
fn build_terms<R: Rng>(samples: &[ExampleSample], tagging_model: &str, rng: &mut R) -> Vec<String> {
    let mut terms: Vec<String> = Vec::new();
    if samples.is_empty() {
        terms.extend(DEFAULT_TERMS.iter().map(|s| s.to_string()));
    }
    for sample in samples {
        let d = datum(sample, tagging_model);
        let mut pick = |v: &[String], terms: &mut Vec<String>| -> String {
            match v.choose(rng) {
                Some(t) => {
                    terms.push(t.clone());
                    t.clone()
                }
                None => String::new(),
            }
        };
        let loc = pick(&d.loc, &mut terms);
        let time = pick(&d.time, &mut terms);
        let thing = pick(&d.things, &mut terms);
        let people = pick(&d.people, &mut terms);
        let (loc, time, thing, people) =
            (loc.as_str(), time.as_str(), thing.as_str(), people.as_str());

        if rng.r#gen::<f64>() > 0.3 {
            terms.push(joined(rng, &[loc, people]));
        }
        if rng.r#gen::<f64>() > 0.3 {
            terms.push(joined(rng, &[time, people]));
        }
        if rng.r#gen::<f64>() > 0.9 {
            terms.push(joined(rng, &[people, thing]));
        }
        if rng.r#gen::<f64>() > 0.95 {
            terms.push(joined(rng, &[loc, people, time, thing]));
        }
        if rng.r#gen::<f64>() > 0.3 {
            terms.push(joined(rng, &[loc, time]));
        }
        if rng.r#gen::<f64>() > 0.9 {
            terms.push(joined(rng, &[loc, thing]));
        }
        if rng.r#gen::<f64>() > 0.9 {
            terms.push(joined(rng, &[time, thing]));
        }
    }
    let mut seen = std::collections::HashSet::new();
    terms
        .into_iter()
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty() && seen.insert(t.clone()))
        .collect()
}
