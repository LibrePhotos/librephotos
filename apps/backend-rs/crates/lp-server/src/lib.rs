//! Router assembly and process wiring for `librephotos-rs`.
//!
//! Nothing area-specific lives here: `lp_api::routes()` and
//! `lp_media::routes()` bring every endpoint, and each crate's
//! `register_jobs` brings its job handlers.

#![allow(clippy::disallowed_methods)] // not a handler crate: SQL allowed here

use std::sync::OnceLock;
use std::time::Duration;

use axum::Router;
use axum::extract::{Request, State};
use axum::http::{HeaderName, HeaderValue, Method, StatusCode, Uri, header};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use lp_core::{ApiError, AppState, Config};
use lp_jobs::HandlerRegistry;
use serde_json::json;
use tower::Layer;
use tower::util::MapRequestLayer;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;

pub mod admin;
pub mod commands;
pub mod dev_proxy;
pub mod logfile;

/// The request path as the client sent it, before the trailing slash was
/// stripped (the dev proxy forwards this one).
#[derive(Debug, Clone)]
pub struct RawPath(pub String);

/// Connect the pool, load site settings, build the state.
pub async fn build_state(config: Config) -> anyhow::Result<AppState> {
    build_state_migrating(config, false).await
}

/// As [`build_state`], applying pending migrations first when asked.
pub async fn build_state_migrating(config: Config, migrate: bool) -> anyhow::Result<AppState> {
    let db = lp_db::connect(&config).await?;
    if migrate {
        lp_db::migrate::run_checked(&db).await?;
    }
    let settings = lp_db::settings::load(&db, &config).await?;
    lp_ingest::vips::install_ml_decoder(config.binaries.vips_lib.clone());
    AppState::new(db, config, settings)
}

/// All job handlers of all crates.
pub fn registry() -> HandlerRegistry {
    let mut reg = HandlerRegistry::new();
    lp_ingest::register_jobs(&mut reg);
    lp_tasks::register_jobs(&mut reg);
    lp_media::register_jobs(&mut reg);
    lp_api::register_jobs(&mut reg);
    reg
}

/// Routes + layers, without the trailing-slash normalization (see [`app`]).
pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/healthz", get(healthz))
        .route("/api/healthz/postgresql", get(healthz_postgresql))
        .route("/api/healthz/queue", get(healthz_queue))
        .route("/api/healthz/ready", get(healthz_ready))
        .merge(lp_api::routes())
        .merge(lp_media::routes())
        .fallback(fallback)
        .layer(cors())
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

pub type App = tower::util::MapRequest<Router, fn(Request) -> Request>;

/// The complete service: strips ONE trailing slash before routing, so
/// `/api/sitesettings` and `/api/sitesettings/` hit the same route.
pub fn app(state: AppState) -> App {
    MapRequestLayer::new(strip_trailing_slash as fn(Request) -> Request).layer(router(state))
}

pub fn strip_trailing_slash(mut req: Request) -> Request {
    let path = req.uri().path().to_string();
    req.extensions_mut().insert(RawPath(path.clone()));
    if path.len() > 1 && path.ends_with('/') {
        let trimmed = &path[..path.len() - 1];
        let pq = match req.uri().query() {
            Some(q) => format!("{trimmed}?{q}"),
            None => trimmed.to_string(),
        };
        let mut parts = req.uri().clone().into_parts();
        if let Ok(p) = pq.parse() {
            parts.path_and_query = Some(p);
            if let Ok(uri) = Uri::from_parts(parts) {
                *req.uri_mut() = uri;
            }
        }
    }
    req
}

fn cors() -> CorsLayer {
    CorsLayer::new()
        .allow_origin(HeaderValue::from_static("http://localhost:3000"))
        .allow_credentials(true)
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::PATCH,
            Method::DELETE,
            Method::HEAD,
            Method::OPTIONS,
        ])
        .allow_headers([
            header::CACHE_CONTROL,
            header::ACCEPT,
            header::ACCEPT_ENCODING,
            header::AUTHORIZATION,
            header::CONTENT_TYPE,
            header::CONTENT_RANGE,
            header::ORIGIN,
            header::USER_AGENT,
            HeaderName::from_static("x-requested-with"),
            HeaderName::from_static("x-csrftoken"),
            HeaderName::from_static("dnt"),
        ])
        .expose_headers([HeaderName::from_static("x-media-error")])
}

async fn fallback(State(state): State<AppState>, req: Request) -> Response {
    let path = req.uri().path();
    let proxied = path.starts_with("/api") || path.starts_with("/media");
    if let (true, Some(target)) = (proxied, state.config.dev_fallback.clone()) {
        return dev_proxy::forward(&target, req).await;
    }
    ApiError::not_found().into_response()
}

async fn healthz() -> Response {
    axum::Json(json!({"status": "ok"})).into_response()
}

fn check(ok: bool, what: &str) -> serde_json::Value {
    if ok {
        json!({"status": "ok"})
    } else {
        json!({"status": "error", "error": format!("{what} unreachable")})
    }
}

fn status_of(ok: bool) -> StatusCode {
    if ok {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    }
}

async fn healthz_postgresql(State(state): State<AppState>) -> Response {
    let ok = lp_db::health::ping(&state.db).await;
    (status_of(ok), axum::Json(check(ok, "database"))).into_response()
}

async fn healthz_queue(State(state): State<AppState>) -> Response {
    let ok = lp_db::health::queue_ping(&state.db).await;
    (status_of(ok), axum::Json(check(ok, "queue broker"))).into_response()
}

async fn healthz_ready(State(state): State<AppState>) -> Response {
    let db = lp_db::health::ping(&state.db).await;
    let queue = lp_db::health::queue_ping(&state.db).await;
    let ok = db && queue;
    let body = json!({
        "status": if ok { "ok" } else { "error" },
        "checks": {"postgresql": check(db, "database"), "queue": check(queue, "queue broker")},
    });
    (status_of(ok), axum::Json(body)).into_response()
}

/// `LOG_LEVEL` (Django names accepted) unless `RUST_LOG` is set.
pub fn init_tracing(config: &Config) {
    static ONCE: OnceLock<()> = OnceLock::new();
    ONCE.get_or_init(|| {
        let level = match config.log_level.to_lowercase().as_str() {
            "critical" | "error" => "error",
            "warning" | "warn" => "warn",
            "debug" => "debug",
            "trace" => "trace",
            _ => "info",
        };
        let filter = tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| {
            tracing_subscriber::EnvFilter::new(format!("{level},sqlx=warn,tower_http=info"))
        });
        let path = config.base_logs.join(logfile::LOG_FILENAME);
        let file = match logfile::RotatingFile::open(&path, logfile::MAX_BYTES, logfile::BACKUPS) {
            Ok(f) => Some(
                tracing_subscriber::fmt::layer()
                    .with_ansi(false)
                    .event_format(logfile::DjangoFormat)
                    .with_writer(std::sync::Arc::new(f)),
            ),
            Err(e) => {
                eprintln!("not logging to {}: {e}", path.display());
                None
            }
        };
        let _ = tracing_subscriber::registry()
            .with(filter)
            .with(tracing_subscriber::fmt::layer())
            .with(file)
            .try_init();
    });
}

/// `librephotos-rs serve`: API + embedded worker until Ctrl-C.
pub async fn serve(config: Config, run_migrations: bool) -> anyhow::Result<()> {
    let bind = config.bind;
    let state = build_state_migrating(config, run_migrations).await?;
    let shutdown = tokio_util::sync::CancellationToken::new();
    let worker = lp_jobs::Worker::new(state.clone(), registry());
    let worker_task = tokio::spawn(worker.run(shutdown.clone()));
    let startup = state.clone();
    tokio::spawn(async move {
        let check = std::time::Instant::now();
        match lp_tasks::clip::reembed_mismatched(&startup).await {
            Ok(n) => tracing::info!(
                users = n,
                secs = check.elapsed().as_secs_f64(),
                "semantic-search model check: queued re-embedding for {n} users"
            ),
            Err(e) => tracing::error!(error = %e, "semantic-search model check failed"),
        }
        match lp_tasks::clip::rebuild_stale_indices(&startup).await {
            Ok(0) => {}
            Ok(n) => tracing::info!(users = n, "rebuilt similarity indices at startup"),
            Err(e) => tracing::error!(error = %e, "similarity index startup check failed"),
        }
    });

    let listener = tokio::net::TcpListener::bind(bind).await?;
    tracing::info!(%bind, "librephotos-rs listening");
    let service = app(state);
    let token = shutdown.clone();
    axum::serve(
        listener,
        axum::ServiceExt::<Request>::into_make_service_with_connect_info::<std::net::SocketAddr>(
            service,
        ),
    )
    .with_graceful_shutdown(async move {
        let _ = tokio::signal::ctrl_c().await;
        token.cancel();
    })
    .await?;
    shutdown.cancel();
    let _ = tokio::time::timeout(Duration::from_secs(10), worker_task).await;
    Ok(())
}

/// `librephotos-rs worker`: jobs only.
pub async fn run_worker(config: Config) -> anyhow::Result<()> {
    let state = build_state(config).await?;
    let shutdown = tokio_util::sync::CancellationToken::new();
    let token = shutdown.clone();
    tokio::spawn(async move {
        let _ = tokio::signal::ctrl_c().await;
        token.cancel();
    });
    lp_jobs::Worker::new(state, registry()).run(shutdown).await
}

/// `librephotos-rs models`: the catalog with what is installed, or download.
pub async fn models_cli(
    config: &Config,
    download: bool,
    all: bool,
    names: &[String],
) -> anyhow::Result<()> {
    use lp_ml::models;
    let dir = config.data_models_dir();
    let wanted: Vec<&models::ModelSpec> = if all || names.is_empty() {
        models::CATALOG.iter().collect()
    } else {
        names
            .iter()
            .map(|n| models::by_name(n).ok_or_else(|| anyhow::anyhow!("unknown model {n}")))
            .collect::<anyhow::Result<_>>()?
    };
    if download {
        if !all && names.is_empty() {
            anyhow::bail!("name the models to download, or pass --all");
        }
        let http = models::http_client()?;
        for m in &wanted {
            let started = std::time::Instant::now();
            let outcome = models::download_model(&http, &dir, m, &models::selecting(m)).await?;
            println!(
                "{:<16} {:?} ({:.1} s)",
                m.name,
                outcome,
                started.elapsed().as_secs_f64()
            );
        }
    }
    println!("{}", dir.display());
    for m in wanted {
        let present = models::target_exists(&dir, m);
        let mb = models::size_on_disk(&dir, m) as f64 / 1_048_576.0;
        println!(
            "{:<16} {:<16} {:<8} {:>9.1} MB",
            m.name,
            format!("{:?}", m.ml_type),
            if present { "present" } else { "missing" },
            mb
        );
    }
    Ok(())
}
