//! W2: user journeys J1-J6 replayed from the recorded frontend request sequences
//! (tests/smoke walk against Django, 03-api-surface.md §4), driven as an open model.
//!
//! A journey behaves like one browser tab: at most 6 requests in flight (HTTP/1.1
//! per-host limit), redirects followed by hand so a Django 301 costs a second
//! round trip exactly as it does for the frontend.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use futures::future::join_all;
use rand::Rng;
use serde::Serialize;
use serde_json::Value;
use tokio::sync::Semaphore;

use crate::http;
use crate::procstat::{self, SampleSummary};
use crate::stats::{self, Counts, Latency};

const THUMBS_PER_GROUP: usize = 12;
const SEARCH_TERMS: [&str; 5] = ["beach", "Berlin", "Person 0002", "tag-03", "sunset"];

#[derive(Default)]
pub struct Data {
    pub photos: Vec<(String, String)>, // (image hash, uuid)
    pub persons: Vec<i64>,
    pub user_albums: Vec<i64>,
    pub auto_albums: Vec<i64>,
    pub thing_albums: Vec<i64>,
    pub place_albums: Vec<i64>,
}

pub struct Env {
    pub client: reqwest::Client,
    pub base: String,
    pub token: String,
    pub user_id: i64,
    pub data: Data,
}

struct Agg {
    req: hdrhistogram::Histogram<u64>,
    journey: hdrhistogram::Histogram<u64>,
    counts: Counts,
    requests: u64,
    redirects: u64,
    redirect_ms: f64,
    journeys_ok: u64,
    journeys_failed: u64,
}

impl Agg {
    fn new() -> Self {
        Agg {
            req: stats::hist(),
            journey: stats::hist(),
            counts: Counts::default(),
            requests: 0,
            redirects: 0,
            redirect_ms: 0.0,
            journeys_ok: 0,
            journeys_failed: 0,
        }
    }
}

/// One journey's recording, merged into the step aggregate when it ends.
struct Tab<'a> {
    env: &'a Env,
    sem: Semaphore,
    rec: Mutex<Agg>,
}

impl<'a> Tab<'a> {
    fn new(env: &'a Env) -> Self {
        let agg = Agg::new();
        Tab { env, sem: Semaphore::new(6), rec: Mutex::new(agg) }
    }

    /// GET with redirects followed; returns the final body when it is a 200.
    async fn get(&self, path: &str, json: bool) -> Option<Value> {
        let mut path = path.to_string();
        for _hop in 0..3 {
            let r = {
                let _permit = self.sem.acquire().await.ok()?;
                http::get(&self.env.client, &self.env.base, &path, &self.env.token).await
            };
            let mut rec = self.rec.lock().unwrap();
            rec.requests += 1;
            match r {
                Err(kind) => {
                    rec.counts.error(format!("{kind} {path}"));
                    return None;
                }
                Ok(r) => {
                    stats::record(&mut rec.req, r.latency);
                    *rec.counts.statuses.entry(r.status).or_default() += 1;
                    rec.counts.bytes += r.body.len() as u64;
                    if (300..400).contains(&r.status) {
                        rec.redirects += 1;
                        rec.redirect_ms += r.latency.as_secs_f64() * 1000.0;
                        match r.location {
                            Some(loc) => {
                                path = http::location_path(&loc);
                                continue;
                            }
                            None => {
                                rec.counts.fail(format!("redirect without location {path}"));
                                return None;
                            }
                        }
                    }
                    // A tile of a photo without thumbnails is a 404 on both backends
                    // (the UI shows a placeholder); it is an answer, not a failure.
                    if !json && r.status == 404 {
                        rec.counts.ok += 1;
                        return Some(Value::Null);
                    }
                    if r.status != 200 {
                        rec.counts.fail(format!("status {} {path}", r.status));
                        return None;
                    }
                    if r.body.is_empty() {
                        rec.counts.fail(format!("empty body {path}"));
                        return None;
                    }
                    if !json {
                        rec.counts.ok += 1;
                        return Some(Value::Null);
                    }
                    return match serde_json::from_slice::<Value>(&r.body) {
                        Ok(v) => {
                            rec.counts.ok += 1;
                            Some(v)
                        }
                        Err(e) => {
                            rec.counts.fail(format!("json {path}: {e}"));
                            None
                        }
                    };
                }
            }
        }
        self.rec.lock().unwrap().counts.fail(format!("redirect loop {path}"));
        None
    }

    async fn api(&self, path: &str) -> Option<Value> {
        self.get(path, true).await
    }

    async fn all(&self, paths: &[String]) -> Vec<Option<Value>> {
        join_all(paths.iter().map(|p| self.api(p))).await
    }

    async fn thumbs(&self, hashes: &[String], kinds: &[&str]) {
        let mut paths = Vec::new();
        for h in hashes {
            for k in kinds {
                paths.push(format!("/media/{k}/{h}"));
            }
        }
        join_all(paths.iter().map(|p| self.get(p, false))).await;
    }

    /// The requests every protected page fires on load.
    async fn shell(&self, timeline: bool) -> Vec<Option<Value>> {
        let uid = self.env.user_id;
        let mut paths: Vec<String> = [
            "/api/searchtermexamples/",
            "/api/albums/place/list/",
            "/api/albums/thing/list/",
            "/api/persons/?page_size=1000",
            "/api/albums/user/list/",
            "/api/rqavailable/",
            "/api/storagestats/",
            "/api/imagetag/",
            "/api/sitesettings",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        paths.push(format!("/api/user/{uid}/"));
        if timeline {
            paths.push("/api/tags/".into());
            paths.push("/api/user/".into());
        }
        self.all(&paths).await
    }
}

/// Photo hashes (PigPhoto `url`) found anywhere in a response, in document order.
fn hashes(v: &Value, max: usize, out: &mut Vec<String>) {
    if out.len() >= max {
        return;
    }
    match v {
        Value::Object(o) => {
            if let Some(Value::String(u)) = o.get("url") {
                if u.len() >= 32 && u.bytes().all(|b| b.is_ascii_hexdigit()) {
                    out.push(u.clone());
                    return;
                }
            }
            for x in o.values() {
                hashes(x, max, out);
            }
        }
        Value::Array(a) => {
            for x in a {
                hashes(x, max, out);
            }
        }
        _ => {}
    }
}

fn ids(v: &Option<Value>, ptr: &str) -> Vec<i64> {
    v.as_ref()
        .and_then(|v| v.pointer(ptr))
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(|x| x.get("id").and_then(as_id)).collect())
        .unwrap_or_default()
}

async fn j1(t: &Tab<'_>) {
    let (shell, list) = tokio::join!(t.shell(true), t.api("/api/albums/date/list/"));
    drop(shell);
    let groups = ids(&list, "/results");
    for (i, g) in groups.iter().take(20).enumerate() {
        if let Some(page) = t.api(&format!("/api/albums/date/{g}?page=1")).await {
            let mut hs = Vec::new();
            hashes(&page, THUMBS_PER_GROUP, &mut hs);
            t.thumbs(&hs, &["square_thumbnails_small", "square_thumbnails"]).await;
        }
        if i % 4 == 3 {
            t.api("/api/rqavailable/").await;
        }
    }
}

async fn j2(t: &Tab<'_>, start: usize) {
    let photos = &t.env.data.photos;
    t.api("/api/photo/share/list").await;
    for i in 0..20 {
        let (h, id) = &photos[(start + i) % photos.len()];
        let paths = [
            format!("/api/photos/{h}/"),
            format!("/api/photos/{h}/albums/"),
            format!("/api/photos/{id}/metadata"),
            format!("/api/tags/?photo={id}"),
        ];
        let big = format!("/media/thumbnails_big/{h}");
        tokio::join!(t.all(&paths), t.get(&big, false));
        if i % 4 == 3 {
            t.api("/api/rqavailable/").await;
        }
    }
}

async fn j3(t: &Tab<'_>, person: i64) {
    t.shell(false).await;
    let paths = [format!("/api/albums/date/list/?person={person}"), "/api/tags/".into(), "/api/user/".into()];
    let r = t.all(&paths).await;
    let groups = ids(&r[0], "/results");
    for g in groups.iter().take(4) {
        if let Some(page) = t.api(&format!("/api/albums/date/{g}?page=1&person={person}")).await {
            let mut hs = Vec::new();
            hashes(&page, THUMBS_PER_GROUP, &mut hs);
            t.thumbs(&hs, &["square_thumbnails_small", "square_thumbnails"]).await;
        }
    }
}

async fn j4(t: &Tab<'_>) {
    t.shell(true).await;
    for term in SEARCH_TERMS {
        let q = term.replace(' ', "%20");
        if let Some(v) = t.api(&format!("/api/photos/searchlist/?search={q}")).await {
            let mut hs = Vec::new();
            hashes(&v, THUMBS_PER_GROUP, &mut hs);
            t.thumbs(&hs, &["square_thumbnails_small", "square_thumbnails"]).await;
        }
    }
}

async fn j5(t: &Tab<'_>, pick: usize) {
    let d = &t.env.data;
    t.shell(true).await;
    let index: Vec<String> = ["/api/locclust/", "/api/folders/subfolders/", "/api/albums/auto/list/"]
        .iter()
        .map(|s| s.to_string())
        .collect();
    t.all(&index).await;
    let nth = |v: &Vec<i64>, k: usize| v.get((pick + k * 7) % v.len().max(1)).copied();
    let mut details = Vec::new();
    for k in 0..3 {
        if let Some(id) = nth(&d.user_albums, k) {
            details.push(format!("/api/albums/user/{id}/"));
        }
    }
    for k in 0..2 {
        if let Some(id) = nth(&d.auto_albums, k) {
            details.push(format!("/api/albums/auto/{id}/"));
        }
        if let Some(id) = nth(&d.thing_albums, k) {
            details.push(format!("/api/albums/thing/{id}/"));
        }
    }
    if let Some(id) = nth(&d.place_albums, 0) {
        details.push(format!("/api/albums/place/{id}/"));
    }
    for p in details {
        if let Some(v) = t.api(&p).await {
            let mut hs = Vec::new();
            hashes(&v, THUMBS_PER_GROUP, &mut hs);
            t.thumbs(&hs, &["square_thumbnails"]).await;
        }
    }
}

async fn j6(t: &Tab<'_>) {
    t.api("/api/rqavailable/").await;
}

async fn run_one(env: &Env, journey: &str, seed: usize) -> Agg {
    let t = Tab::new(env);
    let t0 = Instant::now();
    match journey {
        "J1" => j1(&t).await,
        "J2" => j2(&t, seed.wrapping_mul(20)).await,
        "J3" => {
            let p = env.data.persons[seed % env.data.persons.len().min(20).max(1)];
            j3(&t, p).await
        }
        "J4" => j4(&t).await,
        "J5" => j5(&t, seed).await,
        "J6" => j6(&t).await,
        other => panic!("unknown journey {other}"),
    }
    let mut agg = t.rec.into_inner().unwrap();
    stats::record(&mut agg.journey, t0.elapsed());
    if agg.counts.errors + agg.counts.check_failed == 0 {
        agg.journeys_ok = 1;
    } else {
        agg.journeys_failed = 1;
    }
    agg
}

/// Ids the journeys need, discovered from the server under test before measuring.
pub async fn discover(client: &reqwest::Client, base: &str, token: &str) -> anyhow::Result<Data> {
    let get = |p: String| async move {
        let r = http::get(client, base, &p, token).await.map_err(|e| anyhow::anyhow!("{e} {p}"))?;
        anyhow::ensure!(r.status == 200, "{} {p}", r.status);
        Ok::<Value, anyhow::Error>(serde_json::from_slice(&r.body)?)
    };
    let list = get("/api/albums/date/list/".into()).await?;
    let groups = ids(&Some(list), "/results");
    let mut photos = Vec::new();
    let step = (groups.len() / 25).max(1);
    for g in groups.iter().step_by(step).take(25) {
        let page = get(format!("/api/albums/date/{g}/?page=1")).await?;
        if let Some(items) = page.pointer("/results/items").and_then(Value::as_array) {
            for it in items.iter().take(20) {
                if let (Some(h), Some(id)) = (it.get("url").and_then(Value::as_str), it.get("id").and_then(Value::as_str)) {
                    photos.push((h.to_string(), id.to_string()));
                }
            }
        }
    }
    let persons = get("/api/persons/?page_size=1000".into()).await?;
    let mut ps: Vec<(i64, i64)> = persons
        .pointer("/results")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|p| Some((p.get("id")?.as_i64()?, p.get("face_count").and_then(Value::as_i64).unwrap_or(0))))
                .collect()
        })
        .unwrap_or_default();
    ps.sort_by_key(|(_, c)| -c);
    let lists = |v: Value| ids(&Some(v), "/results");
    Ok(Data {
        photos,
        persons: ps.into_iter().map(|(id, _)| id).collect(),
        user_albums: lists(get("/api/albums/user/list/".into()).await?),
        auto_albums: lists(get("/api/albums/auto/list/".into()).await?),
        thing_albums: lists(get("/api/albums/thing/list/".into()).await?),
        place_albums: lists(get("/api/albums/place/list/".into()).await?),
    })
}

#[derive(Serialize)]
pub struct Step {
    pub rate: f64,
    pub duration_s: f64,
    pub journeys_started: u64,
    pub journeys_ok: u64,
    pub journeys_failed: u64,
    pub overloaded: u64,
    pub requests: u64,
    pub requests_per_journey: f64,
    pub redirects_per_journey: f64,
    pub redirect_ms_per_journey: f64,
    pub request_latency: Latency,
    pub journey_latency: Latency,
    pub counts: Counts,
    pub pass: bool,
    pub server_cpu_s: f64,
    pub pg_cpu_s: f64,
    pub client_cpu_s: f64,
    pub server_rss: SampleSummary,
}

pub struct RunOpts {
    pub journey: String,
    pub duration: Duration,
    pub drain: Duration,
    pub max_inflight: usize,
    pub server_pids: Vec<u32>,
    pub pg_pids: Vec<u32>,
    pub p99_limit_ms: f64,
}

/// Open model: journeys start at a fixed rate whatever the server does.
pub async fn run_rate(env: Arc<Env>, o: &RunOpts, rate: f64) -> Step {
    let agg = Arc::new(Mutex::new(Agg::new()));
    let inflight = Arc::new(AtomicUsize::new(0));
    let cpu0 = procstat::tree_stat(&o.server_pids).cpu_s;
    let pg0 = procstat::tree_stat(&o.pg_pids).cpu_s;
    let me0 = procstat::self_cpu();
    let sampler = procstat::Sampler::start(o.server_pids.clone(), Duration::from_millis(500));
    let t0 = tokio::time::Instant::now();
    let interval = Duration::from_secs_f64(1.0 / rate);
    let n = (o.duration.as_secs_f64() * rate).round().max(1.0) as usize;
    let mut handles = Vec::with_capacity(n);
    let mut overloaded = 0u64;
    let seed0: usize = rand::thread_rng().gen_range(0..10_000);
    for i in 0..n {
        tokio::time::sleep_until(t0 + interval.mul_f64(i as f64)).await;
        if inflight.load(Ordering::Relaxed) >= o.max_inflight {
            overloaded += 1;
            continue;
        }
        inflight.fetch_add(1, Ordering::Relaxed);
        let (env, agg, inflight, journey) = (env.clone(), agg.clone(), inflight.clone(), o.journey.clone());
        handles.push(tokio::spawn(async move {
            let a = run_one(&env, &journey, seed0 + i).await;
            inflight.fetch_sub(1, Ordering::Relaxed);
            let mut g = agg.lock().unwrap();
            g.req.add(&a.req).ok();
            g.journey.add(&a.journey).ok();
            g.counts.merge(&a.counts);
            g.requests += a.requests;
            g.redirects += a.redirects;
            g.redirect_ms += a.redirect_ms;
            g.journeys_ok += a.journeys_ok;
            g.journeys_failed += a.journeys_failed;
        }));
    }
    let deadline = tokio::time::Instant::now() + o.drain;
    let mut unfinished = 0u64;
    for h in handles {
        if tokio::time::timeout_at(deadline, h).await.is_err() {
            unfinished += 1;
        }
    }
    let rss = sampler.finish();
    let cpu = procstat::tree_stat(&o.server_pids).cpu_s - cpu0;
    let pg = procstat::tree_stat(&o.pg_pids).cpu_s - pg0;
    let me = procstat::self_cpu() - me0;
    let g = agg.lock().unwrap();
    let started = n as u64 - overloaded;
    let failed = g.journeys_failed + unfinished + overloaded;
    let lat = stats::summarize(&g.req);
    let bad = g.counts.errors + g.counts.check_failed;
    let pass = lat.p99_ms < o.p99_limit_ms
        && overloaded == 0
        && unfinished == 0
        && (failed as f64) <= 0.01 * n as f64
        && (bad as f64) <= 0.01 * g.requests.max(1) as f64;
    let per = |x: f64| if g.journeys_ok + g.journeys_failed > 0 { x / (g.journeys_ok + g.journeys_failed) as f64 } else { 0.0 };
    Step {
        rate,
        duration_s: o.duration.as_secs_f64(),
        journeys_started: started,
        journeys_ok: g.journeys_ok,
        journeys_failed: failed,
        overloaded,
        requests: g.requests,
        requests_per_journey: per(g.requests as f64),
        redirects_per_journey: per(g.redirects as f64),
        redirect_ms_per_journey: per(g.redirect_ms),
        request_latency: lat,
        journey_latency: stats::summarize(&g.journey),
        counts: g.counts.clone(),
        pass,
        server_cpu_s: cpu,
        pg_cpu_s: pg,
        client_cpu_s: me,
        server_rss: rss,
    }
}

/// Ids are numbers, except date groups, whose ids are strings ("1010").
fn as_id(v: &Value) -> Option<i64> {
    v.as_i64().or_else(|| v.as_str().and_then(|s| s.parse().ok()))
}
