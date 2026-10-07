//! Shared helpers for the lp-tasks integration tests: a mock of every
//! sidecar (and of Nominatim) on one local port, the app wired to it, and a
//! way to run a registered job the way the worker will.

#![allow(clippy::disallowed_methods, dead_code)]

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use axum::Router;
use axum::body::Bytes;
use axum::http::{Method, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use lp_core::AppState;
use lp_db::db::Db;
use lp_jobs::{EnqueueOptions, HandlerRegistry, JobCtx};
use lp_sidecars::Sidecar;
use lp_testkit::TestApp;
use serde_json::{Value, json};

pub const DIM: usize = 512;

pub fn fixture_root() -> PathBuf {
    PathBuf::from(
        std::env::var("LP_FIXTURE_ROOT")
            .unwrap_or_else(|_| "C:/Users/Niaz/librephotos/rust-pg/fixture".into()),
    )
}

pub fn manifest() -> Value {
    let text = std::fs::read_to_string(fixture_root().join("manifest.json")).expect("manifest");
    serde_json::from_str(&text).expect("manifest json")
}

/// ExifTool of the backend venv, when this machine has it.
pub fn exiftool() -> Option<PathBuf> {
    let p = std::env::var("LP_EXIFTOOL").map(PathBuf::from).unwrap_or_else(|_| {
        PathBuf::from(
            "C:/Users/Niaz/librephotos/wt-windev/apps/backend/.venv-win/Lib/site-packages/exiftool_bin/exiftool.exe",
        )
    });
    p.exists().then_some(p)
}

pub fn fnv(s: &str) -> u64 {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in s.bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}

/// A deterministic unit-ish vector for `key`.
pub fn vector(key: &str, dim: usize) -> Vec<f64> {
    let mut x = fnv(key) | 1;
    (0..dim)
        .map(|_| {
            x ^= x << 13;
            x ^= x >> 7;
            x ^= x << 17;
            ((x % 20001) as f64 / 10000.0) - 1.0
        })
        .collect()
}

pub fn basename(path: &str) -> String {
    path.rsplit(['/', '\\']).next().unwrap_or(path).to_string()
}

/// Faces the mock "detects" on an image: 0-2 boxes inside it; encodings
/// for all but every fifth image (an older sidecar sends none).
pub fn mock_faces(name: &str, w: u32, h: u32) -> (Vec<[i32; 4]>, Option<Vec<Vec<f64>>>) {
    let seed = fnv(name);
    let n = (seed % 3) as usize;
    let (fw, fh) = ((w / 5).max(2), (h / 5).max(2));
    let boxes: Vec<[i32; 4]> = (0..n)
        .map(|i| {
            let left = if i == 0 { w / 10 } else { w / 2 };
            let top = h / 4;
            [
                top as i32,
                (left + fw) as i32,
                (top + fh) as i32,
                left as i32,
            ]
        })
        .collect();
    let encodings = (!seed.is_multiple_of(5)).then(|| {
        (0..n)
            .map(|i| vector(&format!("{name}#{i}"), DIM))
            .collect()
    });
    (boxes, encodings)
}

pub fn mock_tags(name: &str) -> Vec<String> {
    const LABELS: [&str; 6] = ["beach", "sunset", "dog", "mountain", "receipt", "city"];
    let seed = fnv(name) as usize;
    vec![
        LABELS[seed % LABELS.len()].to_string(),
        LABELS[(seed / 7 + 1) % LABELS.len()].to_string(),
    ]
}

pub fn mock_ocr_text(name: &str) -> &'static str {
    match fnv(name) % 3 {
        0 => "Coffee 3,50 €\nCake 4,20 €\nTOTAL 7,70 €",
        1 => "hello",
        _ => "",
    }
}

#[derive(Default)]
pub struct Knobs {
    /// Status to answer instead, per path prefix (e.g. `/generate-tags` -> 500).
    pub fail: Vec<(String, u16, Value)>,
    pub cluster_labels: Option<Vec<i64>>,
    pub train_reply: Option<Value>,
    pub build_refuse: bool,
    pub clip_null_every: Option<usize>,
}

#[derive(Clone, Default)]
pub struct Mock {
    pub calls: Arc<Mutex<Vec<(String, Value)>>>,
    pub knobs: Arc<Mutex<Knobs>>,
}

impl Mock {
    pub fn calls_to(&self, path: &str) -> Vec<Value> {
        self.calls
            .lock()
            .unwrap()
            .iter()
            .filter(|(p, _)| p == path)
            .map(|(_, b)| b.clone())
            .collect()
    }

    pub fn clear(&self) {
        self.calls.lock().unwrap().clear();
    }
}

fn json_reply(status: u16, v: Value) -> Response {
    (StatusCode::from_u16(status).unwrap(), axum::Json(v)).into_response()
}

async fn handle(mock: Mock, method: Method, uri: Uri, body: Bytes) -> Response {
    let path = uri.path().to_string();
    let body: Value = if body.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&body).unwrap_or(Value::Null)
    };
    let query: Value = uri
        .query()
        .map(|q| {
            let pairs: Vec<(String, String)> = serde_urlencoded::from_str(q).unwrap_or_default();
            Value::Object(
                pairs
                    .into_iter()
                    .map(|(k, v)| (k, Value::from(v)))
                    .collect(),
            )
        })
        .unwrap_or(Value::Null);
    let recorded = if method == Method::GET {
        query.clone()
    } else {
        body.clone()
    };
    mock.calls.lock().unwrap().push((path.clone(), recorded));
    {
        let knobs = mock.knobs.lock().unwrap();
        if let Some((_, status, reply)) = knobs
            .fail
            .iter()
            .find(|(p, _, _)| path.starts_with(p.as_str()))
        {
            return json_reply(*status, reply.clone());
        }
    }
    let s = |k: &str| {
        body.get(k)
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string()
    };
    match path.as_str() {
        "/health" => json_reply(
            200,
            json!({"status": "OK", "service": "mock", "busy": false}),
        ),
        "/unload-model" => json_reply(200, json!({"status": "OK"})),
        "/face-locations" => {
            let src = s("source");
            let (w, h) = image::image_dimensions(&src).unwrap_or((100, 100));
            let (boxes, encodings) = mock_faces(&basename(&src), w, h);
            let mut reply = json!({"face_locations": boxes});
            if let Some(e) = encodings {
                reply["encodings"] = json!(e);
            }
            json_reply(200, reply)
        }
        "/face-encodings" => {
            let src = s("source");
            let locs = body["face_locations"]
                .as_array()
                .cloned()
                .unwrap_or_default();
            let encodings: Vec<Value> = locs
                .iter()
                .map(|l| {
                    if l[0].as_i64().unwrap_or(0) < 0 {
                        Value::Null
                    } else {
                        json!(vector(&format!("{}@{}", basename(&src), l), DIM))
                    }
                })
                .collect();
            json_reply(200, json!({"encodings": encodings}))
        }
        "/clip-embeddings" => {
            let imgs = body["imgs"].as_array().cloned().unwrap_or_default();
            let every = mock.knobs.lock().unwrap().clip_null_every;
            let mut embs = Vec::new();
            let mut mags = Vec::new();
            for (i, img) in imgs.iter().enumerate() {
                if every.is_some_and(|n| i % n == 0) {
                    embs.push(Value::Null);
                    mags.push(Value::Null);
                    continue;
                }
                let v = vector(&basename(img.as_str().unwrap_or("")), DIM);
                let mag = v.iter().map(|x| x * x).sum::<f64>().sqrt();
                embs.push(json!(v));
                mags.push(json!(mag));
            }
            json_reply(200, json!({"imgs_emb": embs, "magnitudes": mags}))
        }
        "/generate-tags" => {
            let tags = mock_tags(&basename(&s("image_path")));
            json_reply(200, json!({"tags": {"tags": tags}}))
        }
        "/ocr" => {
            let name = basename(&s("image_path"));
            let text = mock_ocr_text(&name);
            json_reply(
                200,
                json!({
                    "text": text,
                    "blocks": [{"text": text, "box": [[0, 0], [10, 0], [10, 5], [0, 5]], "confidence": 0.9}],
                    "image_width": 640, "image_height": 480,
                    "mean_confidence": 0.91, "text_area_fraction": if text.len() > 20 { 0.25 } else { 0.01 },
                }),
            )
        }
        "/generate-caption" => json_reply(
            200,
            json!({"caption": format!("<start> a photo of {} <end> ", basename(&s("image_path")))}),
        ),
        "/build/" if method == Method::POST => {
            if mock.knobs.lock().unwrap().build_refuse {
                return json_reply(200, json!({"status": false, "error": "refused by mock"}));
            }
            let n = body["image_hashes"].as_array().map(Vec::len).unwrap_or(0);
            json_reply(200, json!({"status": true, "index_size": n}))
        }
        "/build/" => json_reply(200, json!({"status": true})),
        "/search/" => json_reply(200, json!({"status": true, "result": ["a", "b"]})),
        "/cluster" => {
            let n = body["faces"].as_array().map(Vec::len).unwrap_or(0);
            let ids: Vec<Value> = body["faces"]
                .as_array()
                .into_iter()
                .flatten()
                .map(|f| f["id"].clone())
                .collect();
            let labels = mock
                .knobs
                .lock()
                .unwrap()
                .cluster_labels
                .clone()
                .unwrap_or_else(|| vec![0; n]);
            json_reply(200, json!({"ids": ids, "labels": labels}))
        }
        "/train" => {
            if let Some(reply) = mock.knobs.lock().unwrap().train_reply.clone() {
                return json_reply(200, reply);
            }
            let first_cluster = body["clusters"][0]["person_id"].clone();
            let first_known = body["known"][0]["person_id"].clone();
            let preds: Vec<Value> = body["unknown"]
                .as_array()
                .into_iter()
                .flatten()
                .map(|u| {
                    json!({
                        "id": u["id"],
                        "cluster_person_id": if first_cluster.is_null() { first_known.clone() } else { first_cluster.clone() },
                        "cluster_probability": 0.75,
                        "classification_person_id": first_known,
                        "classification_probability": if first_known.is_null() { 0.0 } else { 0.6 },
                    })
                })
                .collect();
            json_reply(200, json!({"predictions": preds}))
        }
        "/pca" => {
            let n = body["encodings"].as_array().map(Vec::len).unwrap_or(0);
            json_reply(200, json!({"coordinates": vec![[0.0, 1.0, 2.0]; n]}))
        }
        "/reverse" => {
            let lat: f64 = query["lat"]
                .as_str()
                .and_then(|v| v.parse().ok())
                .unwrap_or(0.0);
            let lon: f64 = query["lon"]
                .as_str()
                .and_then(|v| v.parse().ok())
                .unwrap_or(0.0);
            let (city, country) = if lat > 45.0 {
                ("Berlin", "Deutschland")
            } else {
                ("Tokyo", "Japan")
            };
            json_reply(
                200,
                json!({
                    "lat": format!("{lat}"), "lon": format!("{lon}"),
                    "display_name": format!("Mock Street 1, {city}, {country}"),
                    "address": {"road": "Mock Street", "house_number": "1", "suburb": "12345",
                                "city": city, "state": city, "country": country, "postcode": "10117"}
                }),
            )
        }
        _ => json_reply(404, json!({"error": format!("mock has no {path}")})),
    }
}

/// Start the mock on an ephemeral port; returns it and its base URL.
pub async fn start_mock() -> (Mock, String) {
    let mock = Mock::default();
    let m = mock.clone();
    let app = Router::new().fallback(move |method: Method, uri: Uri, body: Bytes| {
        let m = m.clone();
        async move { handle(m, method, uri, body).await }
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    (mock, format!("http://{addr}"))
}

/// Features on, ExifTool configured when present.
pub fn feature_env() -> Vec<(&'static str, String)> {
    let mut env = vec![
        ("FEATURE_FACE_DETECTION", "1".to_string()),
        ("FEATURE_FACE_CLUSTER", "1".to_string()),
        ("FEATURE_IMAGE_CAPTIONING", "1".to_string()),
        ("FEATURE_REVERSE_GEOCODING", "1".to_string()),
        ("FEATURE_SCENE_CLASSIFICATION", "1".to_string()),
        ("WORKER_CONCURRENCY", "4".to_string()),
    ];
    match exiftool() {
        Some(p) => env.push(("LP_EXIFTOOL", p.display().to_string())),
        None => env.push(("LP_EXIFTOOL", "lp-no-exiftool-here".to_string())),
    }
    env
}

pub struct TasksApp {
    pub app: TestApp,
    pub state: AppState,
    pub mock: Mock,
    pub base: String,
}

impl TasksApp {
    /// A private fixture clone whose sidecars all point at a fresh mock.
    pub async fn new() -> TasksApp {
        Self::with_env(&[]).await
    }

    pub async fn with_env(extra: &[(&str, &str)]) -> TasksApp {
        let env = feature_env();
        let mut vars: Vec<(&str, &str)> = env.iter().map(|(k, v)| (*k, v.as_str())).collect();
        vars.extend_from_slice(extra);
        let app = TestApp::with_env(&vars).await;
        let (mock, base) = start_mock().await;
        let mut state = app.state.clone();
        let mut sidecars = state.sidecars.clone();
        for s in Sidecar::ALL {
            sidecars = sidecars.with_base(s, &base);
        }
        state.sidecars = sidecars;
        TasksApp {
            app,
            state,
            mock,
            base,
        }
    }

    pub fn db(&self) -> &Db {
        &self.state.db
    }

    /// Copy the fixture's big thumbnails into this app's MEDIA_ROOT.
    pub fn copy_thumbnails(&self) {
        let from = fixture_root()
            .join("protected_media")
            .join("thumbnails_big");
        let to = self.state.config.thumbnails_big_dir();
        std::fs::create_dir_all(&to).unwrap();
        for entry in std::fs::read_dir(&from).expect("fixture thumbnails") {
            let entry = entry.unwrap();
            std::fs::copy(entry.path(), to.join(entry.file_name())).unwrap();
        }
    }

    pub async fn cleanup(self) {
        self.app.cleanup().await;
    }
}

pub fn registry() -> HandlerRegistry {
    let mut reg = HandlerRegistry::new();
    lp_tasks::register_jobs(&mut reg);
    reg
}

/// Enqueue `kind`, claim it like the worker and run its handler. Returns
/// the handler's result and the LongRunningJob id the enqueue created.
pub async fn run_job(
    state: &AppState,
    kind: &str,
    payload: Value,
    opts: EnqueueOptions,
) -> (anyhow::Result<()>, Option<String>) {
    let enq = lp_jobs::enqueue(state, kind, payload, opts)
        .await
        .expect("enqueue");
    let result = run_queued(state, kind).await.expect("a queued job");
    (result, enq.lrj_id)
}

/// Claim and run the next queued job of `kind`, if any.
pub async fn run_queued(state: &AppState, kind: &str) -> Option<anyhow::Result<()>> {
    let mut conn = state.db.acquire().await.unwrap();
    let job = lp_jobs::queue::claim_next(&mut conn, "lp-tasks-test", &[kind.to_string()])
        .await
        .unwrap()?;
    drop(conn);
    let reg = registry();
    let handler = reg.get(kind).expect("registered kind").clone();
    Some(
        handler(JobCtx {
            state: state.clone(),
            job,
        })
        .await,
    )
}

#[derive(Debug, sqlx::FromRow)]
pub struct JobRow {
    pub job_type: i32,
    pub finished: bool,
    pub failed: bool,
    pub cancelled: bool,
    pub started_at: Option<chrono::DateTime<chrono::Utc>>,
    pub progress_current: i32,
    pub progress_target: i32,
    pub result: Option<Value>,
}

pub async fn job(db: &Db, job_id: &str) -> JobRow {
    lp_db::sql::query_as::<_, JobRow>(
        "SELECT job_type, finished, failed, cancelled, started_at, progress_current, progress_target, \
           result FROM api_longrunningjob WHERE job_id = $1",
    )
    .bind(job_id)
    .fetch_one(db)
    .await
    .expect("job row")
}

pub async fn user_id(db: &Db, name: &str) -> i32 {
    lp_db::sql::query_scalar("SELECT id FROM api_user WHERE username = $1")
        .bind(name)
        .fetch_one(db)
        .await
        .unwrap()
}

pub fn path_of(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}
