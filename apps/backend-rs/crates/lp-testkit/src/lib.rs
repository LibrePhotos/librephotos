//! Integration-test helpers: a throwaway database per test, the full app
//! in-process, users and tokens.
//!
//! ```ignore
//! #[tokio::test]
//! async fn my_endpoint() {
//!     let app = lp_testkit::TestApp::new().await;
//!     let alice = app.create_user("alice", "pw", false).await;
//!     let token = app.token_for(&alice);
//!     let res = app.get("/api/albums/date/list/", Some(&token)).await;
//!     assert_eq!(res.status, 200);
//!     app.cleanup().await;
//! }
//! ```
//!
//! Database source: `LP_TEST_TEMPLATE` (default `lp_fixture`) is cloned when
//! it exists and brought up to date (adopted or migrated); otherwise an
//! empty schema is cloned from a cached template built from `migrations/pg`.
//! Server: `LP_TEST_PG_HOST` (localhost), `LP_TEST_PG_PORT` (5433),
//! `LP_TEST_PG_USER` (postgres), `LP_TEST_PG_PASS` (x).
//!
//! `LP_TEST_BACKEND=sqlite` runs the same tests on SQLite files instead:
//! copies of `LP_TEST_SQLITE_TEMPLATE` (default the SQLite fixture pack's
//! `lp_fixture.sqlite3`, adopted once per process), else of the migrated
//! `migrations/sqlite` baseline, under `<temp>/lp-testkit-sqlite/`.

#![allow(clippy::disallowed_methods)] // not a handler crate: SQL allowed here

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::Duration;

use axum::body::Body;
use axum::http::{HeaderMap, Method, Request, StatusCode};
use http_body_util::BodyExt;
use lp_core::django_crypto::DjangoCrypto;
use lp_core::{AppState, Config};
use lp_db::db::lite::LiteOptions;
use lp_db::db::{Db, Dialect};
use lp_db::users::User;
use lp_db::write::users::NewUser;
use sha2::{Digest, Sha256};
use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use sqlx::{Connection, PgConnection};
use tower::ServiceExt;

pub use lp_db::db::config::Backend;
pub use lp_server::App;

static COUNTER: AtomicU32 = AtomicU32::new(0);

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key)
        .ok()
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| default.to_string())
}

#[derive(Debug, Clone)]
pub struct PgServer {
    pub host: String,
    pub port: u16,
    pub user: String,
    pub pass: String,
}

impl PgServer {
    pub fn from_env() -> Self {
        PgServer {
            host: env_or("LP_TEST_PG_HOST", "localhost"),
            port: env_or("LP_TEST_PG_PORT", "5433").parse().unwrap_or(5433),
            user: env_or("LP_TEST_PG_USER", "postgres"),
            pass: env_or("LP_TEST_PG_PASS", "x"),
        }
    }

    pub fn options(&self, db: &str) -> PgConnectOptions {
        PgConnectOptions::new()
            .host(&self.host)
            .port(self.port)
            .username(&self.user)
            .password(&self.pass)
            .database(db)
            // As the server's pool: Rust writes set clip_embeddings_model.
            .application_name(lp_db::pool::APPLICATION_NAME)
    }

    async fn admin(&self) -> PgConnection {
        PgConnection::connect_with(&self.options("postgres"))
            .await
            .expect("connect to the test Postgres (LP_TEST_PG_*)")
    }
}

fn quote_ident(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

async fn db_exists(conn: &mut PgConnection, name: &str) -> bool {
    lp_db::sql::query_scalar::<_, bool>(
        "SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1)",
    )
    .bind(name)
    .fetch_one(conn)
    .await
    .unwrap_or(false)
}

/// CREATE DATABASE ... TEMPLATE, retrying while the template is busy.
async fn clone_db(server: &PgServer, name: &str, template: &str) -> Result<(), sqlx::Error> {
    let mut last = None;
    for attempt in 0..40 {
        let mut admin = server.admin().await;
        let sql = format!(
            "CREATE DATABASE {} TEMPLATE {}",
            quote_ident(name),
            quote_ident(template)
        );
        match lp_db::sql::query(&sql).execute(&mut admin).await {
            Ok(_) => return Ok(()),
            Err(e) => {
                let busy = e.to_string().contains("being accessed by other users");
                if !busy {
                    return Err(e);
                }
                last = Some(e);
                tokio::time::sleep(Duration::from_millis(100 + 50 * attempt)).await;
            }
        }
    }
    Err(last.expect("at least one attempt"))
}

/// Empty-schema template named after the migration checksums, built once.
async fn empty_template(server: &PgServer) -> String {
    let mut h = Sha256::new();
    for m in lp_db::migrate::MIGRATOR.migrations.iter() {
        h.update(m.version.to_le_bytes());
        h.update(&*m.checksum);
    }
    let name = format!("lptmpl_{}", &hex::encode(h.finalize())[..12]);
    let mut admin = server.admin().await;
    if db_exists(&mut admin, &name).await {
        return name;
    }
    let building = format!(
        "{name}_b{}_{}",
        std::process::id(),
        COUNTER.fetch_add(1, Ordering::SeqCst)
    );
    lp_db::sql::query(format!(
        "CREATE DATABASE {} TEMPLATE template0",
        quote_ident(&building)
    ))
    .execute(&mut admin)
    .await
    .expect("create template database");
    {
        let pool = Db::Pg(
            PgPoolOptions::new()
                .max_connections(1)
                .connect_with(server.options(&building))
                .await
                .expect("connect template"),
        );
        lp_db::migrate::run(&pool).await.expect("migrate template");
        pool.close().await;
    }
    let renamed = lp_db::sql::query(format!(
        "ALTER DATABASE {} RENAME TO {}",
        quote_ident(&building),
        quote_ident(&name)
    ))
    .execute(&mut admin)
    .await;
    if renamed.is_err() {
        // Another process won the race; ours is redundant.
        let _ = lp_db::sql::query(format!(
            "DROP DATABASE IF EXISTS {} WITH (FORCE)",
            quote_ident(&building)
        ))
        .execute(&mut admin)
        .await;
    }
    name
}

/// Drop `lptest_<pid>_*` databases left behind by test processes that no
/// longer run (a killed run, or the per-process shared database). Once per process.
async fn sweep_stale(server: &PgServer) {
    static SWEPT: std::sync::OnceLock<()> = std::sync::OnceLock::new();
    if SWEPT.set(()).is_err() {
        return;
    }
    let mut admin = server.admin().await;
    let names: Vec<String> =
        lp_db::sql::query_scalar("SELECT datname FROM pg_database WHERE datname LIKE 'lptest\\_%'")
            .fetch_all(&mut admin)
            .await
            .unwrap_or_default();
    let mut sys = sysinfo::System::new();
    sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
    for name in names {
        let pid = name
            .strip_prefix("lptest_")
            .and_then(|r| r.split('_').next())
            .and_then(|p| p.parse::<u32>().ok());
        let Some(pid) = pid else { continue };
        if pid == std::process::id() || sys.process(sysinfo::Pid::from_u32(pid)).is_some() {
            continue;
        }
        let _ = lp_db::sql::query(format!(
            "DROP DATABASE IF EXISTS {} WITH (FORCE)",
            quote_ident(&name)
        ))
        .execute(&mut admin)
        .await;
    }
}

/// `LP_TEST_BACKEND`: `pg` (default; also `postgres`, `postgresql`) or
/// `sqlite` (`sqlite3`). Selects what [`TestDb`] / [`TestApp`] create.
pub fn test_backend() -> Backend {
    match env_or("LP_TEST_BACKEND", "pg")
        .to_ascii_lowercase()
        .as_str()
    {
        "sqlite" | "sqlite3" | "lite" => Backend::Sqlite,
        _ => Backend::Postgres,
    }
}

/// A throwaway database, dropped by [`TestDb::cleanup`] (or on drop).
///
/// On SQLite (`LP_TEST_BACKEND=sqlite`) it is a file in its own temp
/// directory (`name` is the file path): a copy of `LP_TEST_SQLITE_TEMPLATE`
/// (default the SQLite fixture pack's `lp_fixture.sqlite3`) adopted once per
/// test process, or the migrated SQLite baseline when there is no template.
pub struct TestDb {
    pub name: String,
    pub pool: Db,
    pub server: PgServer,
    /// The SQLite file (None on Postgres).
    pub sqlite_path: Option<PathBuf>,
    dropped: bool,
    /// The per-process shared database is never dropped by a test.
    shared: bool,
}

impl TestDb {
    /// A private database for this test (safe for mutations). Creating one
    /// costs several seconds on Windows with Postgres (milliseconds on
    /// SQLite); read-only tests should prefer [`TestDb::shared`].
    pub async fn new() -> TestDb {
        let name = format!(
            "lptest_{}_{}_{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::SeqCst),
            &uuid::Uuid::new_v4().simple().to_string()[..6]
        );
        Self::create(name, false).await
    }

    /// One database per test process, created on first use and reused by
    /// every test that asks for it (dropped by the next run's sweep).
    /// Treat it as read-only, or only add rows with unique names.
    pub async fn shared() -> TestDb {
        static NAME: tokio::sync::OnceCell<String> = tokio::sync::OnceCell::const_new();
        let name = NAME
            .get_or_init(|| async {
                let name = format!("lptest_{}_shared", std::process::id());
                let db = Self::create(name, true).await;
                db.pool.close().await;
                db.name.clone()
            })
            .await
            .clone();
        Self::existing(&name).await
    }

    /// Attach to an existing database (never dropped, not migrated): a
    /// Postgres database name, or on SQLite the path of a file.
    pub async fn existing(name: &str) -> TestDb {
        let server = PgServer::from_env();
        let (pool, sqlite_path) = match test_backend() {
            Backend::Postgres => (
                Db::Pg(
                    PgPoolOptions::new()
                        .max_connections(5)
                        .connect_with(server.options(name))
                        .await
                        .expect("connect existing db"),
                ),
                None,
            ),
            Backend::Sqlite => {
                let path = PathBuf::from(name);
                (open_sqlite(&path, false).await, Some(path))
            }
        };
        TestDb {
            name: name.to_string(),
            pool,
            server,
            sqlite_path,
            dropped: false,
            shared: true,
        }
    }

    async fn create(name: String, shared: bool) -> TestDb {
        if test_backend() == Backend::Sqlite {
            return Self::create_sqlite(name, shared).await;
        }
        let server = PgServer::from_env();
        sweep_stale(&server).await;
        let template = env_or("LP_TEST_TEMPLATE", "lp_fixture");
        let use_fixture = {
            let mut admin = server.admin().await;
            db_exists(&mut admin, &template).await
        };
        if use_fixture {
            clone_db(&server, &name, &template)
                .await
                .expect("clone LP_TEST_TEMPLATE");
        } else {
            let tmpl = empty_template(&server).await;
            clone_db(&server, &name, &tmpl)
                .await
                .expect("clone empty template");
        }
        let pool = Db::Pg(
            PgPoolOptions::new()
                .max_connections(5)
                .connect_with(server.options(&name))
                .await
                .expect("connect test db"),
        );
        if use_fixture {
            let tracked = lp_db::migrate::table_exists(&pool, "_sqlx_migrations")
                .await
                .expect("probe");
            if !tracked {
                lp_db::adopt::adopt(&pool, true)
                    .await
                    .expect("adopt fixture");
            } else {
                lp_db::migrate::run(&pool).await.expect("migrate fixture");
            }
        }
        TestDb {
            name,
            pool,
            server,
            sqlite_path: None,
            dropped: false,
            shared,
        }
    }

    async fn create_sqlite(name: String, shared: bool) -> TestDb {
        sweep_stale_sqlite();
        let template = sqlite_template().await;
        let dir = sqlite_root().join(&name);
        std::fs::create_dir_all(&dir).expect("create the test database directory");
        let path = dir.join("db.sqlite3");
        copy_sqlite(template, &path).expect("copy the SQLite test template");
        let pool = open_sqlite(&path, false).await;
        TestDb {
            name: path.display().to_string(),
            pool,
            server: PgServer::from_env(),
            sqlite_path: Some(path),
            dropped: false,
            shared,
        }
    }

    pub fn backend(&self) -> Backend {
        match self.pool.dialect() {
            Dialect::Pg => Backend::Postgres,
            Dialect::Sqlite => Backend::Sqlite,
        }
    }

    pub async fn cleanup(mut self) {
        self.pool.close().await;
        if self.shared {
            self.dropped = true;
            return;
        }
        if let Some(path) = &self.sqlite_path {
            remove_sqlite_dir(path);
            self.dropped = true;
            return;
        }
        let mut admin = self.server.admin().await;
        let _ = lp_db::sql::query(format!(
            "DROP DATABASE IF EXISTS {} WITH (FORCE)",
            quote_ident(&self.name)
        ))
        .execute(&mut admin)
        .await;
        self.dropped = true;
    }
}

impl Drop for TestDb {
    fn drop(&mut self) {
        if self.dropped || self.shared {
            return;
        }
        if let Some(path) = &self.sqlite_path {
            // Pool connections may still be open (Windows keeps the file);
            // the next run's sweep removes what is left.
            remove_sqlite_dir(path);
            return;
        }
        let server = self.server.clone();
        let name = self.name.clone();
        // Runs outside the test's runtime, which may already be shutting down.
        let _ = std::thread::spawn(move || {
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build();
            if let Ok(rt) = rt {
                rt.block_on(async move {
                    if let Ok(mut admin) =
                        PgConnection::connect_with(&server.options("postgres")).await
                    {
                        let _ = lp_db::sql::query(format!(
                            "DROP DATABASE IF EXISTS {} WITH (FORCE)",
                            quote_ident(&name)
                        ))
                        .execute(&mut admin)
                        .await;
                    }
                });
            }
        })
        .join();
    }
}

// ------------------------------------------------------------------ SQLite

/// Where SQLite test databases live: `<temp>/lp-testkit-sqlite/lptest_<pid>_..`.
fn sqlite_root() -> PathBuf {
    std::env::temp_dir().join("lp-testkit-sqlite")
}

/// `LP_TEST_SQLITE_TEMPLATE`, default the SQLite fixture pack
/// (`tests/fixture/env.sh`: `rust-pg/fixture-sqlite/lp_fixture.sqlite3`).
/// Only ever copied, never opened.
fn sqlite_template_source() -> PathBuf {
    PathBuf::from(env_or(
        "LP_TEST_SQLITE_TEMPLATE",
        "C:/Users/Niaz/librephotos/rust-pg/fixture-sqlite/lp_fixture.sqlite3",
    ))
}

async fn open_sqlite(path: &Path, create: bool) -> Db {
    let mut o = LiteOptions::new(path);
    o.readers = 4;
    o.create = create;
    Db::open_sqlite(&o)
        .await
        .unwrap_or_else(|e| panic!("open SQLite test database {}: {e}", path.display()))
}

/// Copies a SQLite file plus a non-empty `-wal` (a killed writer leaves its
/// commits there; the copy replays them when it is opened).
fn copy_sqlite(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::fs::copy(src, dst)?;
    let wal = |p: &Path| PathBuf::from(format!("{}-wal", p.display()));
    if std::fs::metadata(wal(src)).is_ok_and(|m| m.len() > 0) {
        std::fs::copy(wal(src), wal(dst))?;
    }
    Ok(())
}

/// The per-process template: the fixture copy adopted (or migrated), or the
/// migrated baseline; checkpointed so that a plain file copy is complete.
async fn sqlite_template() -> &'static Path {
    static TEMPLATE: tokio::sync::OnceCell<PathBuf> = tokio::sync::OnceCell::const_new();
    TEMPLATE
        .get_or_init(|| async {
            let dir = sqlite_root().join(format!("lptmpl_{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&dir).expect("create the SQLite template directory");
            let path = dir.join("db.sqlite3");
            let source = sqlite_template_source();
            let from_fixture = source.exists();
            if from_fixture {
                copy_sqlite(&source, &path).expect("copy LP_TEST_SQLITE_TEMPLATE");
            }
            let db = open_sqlite(&path, !from_fixture).await;
            let tracked = lp_db::migrate::table_exists(&db, "_sqlx_migrations")
                .await
                .expect("probe");
            if from_fixture && !tracked {
                lp_db::adopt::adopt(&db, true)
                    .await
                    .expect("adopt the SQLite fixture");
            } else {
                lp_db::migrate::run(&db)
                    .await
                    .expect("migrate the SQLite template");
            }
            lp_db::sql::query("PRAGMA wal_checkpoint(TRUNCATE)")
                .fetch_optional(&db)
                .await
                .expect("checkpoint the SQLite template");
            db.close().await;
            path
        })
        .await
}

fn remove_sqlite_dir(path: &Path) {
    if let Some(dir) = path.parent()
        && dir.starts_with(sqlite_root())
    {
        let _ = std::fs::remove_dir_all(dir);
    }
}

/// Removes the `lptest_<pid>_*` / `lptmpl_<pid>` directories of test
/// processes that no longer run. Once per process.
fn sweep_stale_sqlite() {
    static SWEPT: std::sync::OnceLock<()> = std::sync::OnceLock::new();
    if SWEPT.set(()).is_err() {
        return;
    }
    let Ok(entries) = std::fs::read_dir(sqlite_root()) else {
        return;
    };
    let mut sys = sysinfo::System::new();
    sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
    for e in entries.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        let pid = name
            .strip_prefix("lptest_")
            .or_else(|| name.strip_prefix("lptmpl_"))
            .and_then(|r| r.split('_').next())
            .and_then(|p| p.parse::<u32>().ok());
        let Some(pid) = pid else { continue };
        if pid == std::process::id() || sys.process(sysinfo::Pid::from_u32(pid)).is_some() {
            continue;
        }
        let _ = std::fs::remove_dir_all(e.path());
    }
}

/// Response captured from the in-process app.
#[derive(Debug)]
pub struct TestResponse {
    pub status: StatusCode,
    pub headers: HeaderMap,
    pub body: bytes::Bytes,
}

impl TestResponse {
    pub fn json(&self) -> serde_json::Value {
        serde_json::from_slice(&self.body).unwrap_or_else(|e| {
            panic!(
                "response is not JSON ({e}): {}",
                String::from_utf8_lossy(&self.body)
            )
        })
    }

    pub fn text(&self) -> String {
        String::from_utf8_lossy(&self.body).into_owned()
    }

    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers.get(name).and_then(|v| v.to_str().ok())
    }
}

/// The whole app (all crates' routes, trailing-slash normalization) on a
/// fresh database, with a temp `BASE_DATA`.
pub struct TestApp {
    pub db: TestDb,
    pub state: AppState,
    pub app: App,
    pub base_data: tempfile::TempDir,
}

impl TestApp {
    /// Private database (mutations allowed).
    pub async fn new() -> TestApp {
        Self::build(TestDb::new().await, &[]).await
    }

    /// Per-process shared database: fast, for read-only tests.
    pub async fn shared() -> TestApp {
        Self::build(TestDb::shared().await, &[]).await
    }

    /// The app on an existing database (e.g. a Django-migrated copy that
    /// was adopted), for interop checks. Nothing is created or dropped.
    pub async fn attach(db_name: &str, extra: &[(&str, &str)]) -> TestApp {
        Self::build(TestDb::existing(db_name).await, extra).await
    }

    /// Private database plus extra/override env vars for [`Config`]
    /// (e.g. `("LP_MEDIA_MODE", "x-accel")`).
    pub async fn with_env(extra: &[(&str, &str)]) -> TestApp {
        Self::build(TestDb::new().await, extra).await
    }

    async fn build(db: TestDb, extra: &[(&str, &str)]) -> TestApp {
        let base_data = tempfile::tempdir().expect("tempdir");
        let base = base_data.path().to_path_buf();
        std::fs::create_dir_all(base.join("protected_media")).ok();
        std::fs::create_dir_all(base.join("logs")).ok();
        let mut vars: HashMap<String, String> = HashMap::new();
        let mut set = |k: &str, v: String| {
            vars.insert(k.to_string(), v);
        };
        set("BASE_DATA", base.display().to_string());
        set("BASE_LOGS", base.join("logs").display().to_string());
        set("PHOTOS", base.join("data").display().to_string());
        set("SECRET_KEY", "lp-testkit-secret".into());
        set("DB_NAME", db.name.clone());
        set("DB_HOST", db.server.host.clone());
        set("DB_PORT", db.server.port.to_string());
        set("DB_USER", db.server.user.clone());
        set("DB_PASS", db.server.pass.clone());
        set("LP_DB_POOL", "5".into());
        set("LP_MEDIA_MODE", "direct".into());
        if let Some(path) = &db.sqlite_path {
            set("DB_BACKEND", "sqlite".into());
            set("LP_SQLITE_PATH", path.display().to_string());
        }
        for (k, v) in extra {
            set(k, v.to_string());
        }
        let config = Config::from_map(&vars).expect("test config");
        let settings = lp_db::settings::load(&db.pool, &config)
            .await
            .expect("load settings");
        let state = AppState::new(db.pool.clone(), config, settings).expect("state");
        // Never fetch models from a test (re-enable to test the triggers).
        state.ml.set_auto_download(false);
        let app = lp_server::app(state.clone());
        TestApp {
            db,
            state,
            app,
            base_data,
        }
    }

    pub fn base_path(&self) -> PathBuf {
        self.base_data.path().to_path_buf()
    }

    pub fn pool(&self) -> &Db {
        &self.db.pool
    }

    /// Create a user. The password is stored as a 1-iteration
    /// `pbkdf2_sha256` hash (valid for Django and Rust, but fast).
    pub async fn create_user(&self, username: &str, password: &str, admin: bool) -> User {
        let salt = &uuid::Uuid::new_v4().simple().to_string()[..12];
        let mut out = [0u8; 32];
        pbkdf2::pbkdf2_hmac::<Sha256>(password.as_bytes(), salt.as_bytes(), 1, &mut out);
        use base64::Engine;
        let hash = format!(
            "pbkdf2_sha256$1${salt}${}",
            base64::engine::general_purpose::STANDARD.encode(out)
        );
        let crypto = DjangoCrypto::new(&self.state.config.secret_key);
        let id = lp_db::write::users::create_user(
            &self.db.pool,
            &crypto,
            &NewUser {
                username,
                email: "",
                password_hash: &hash,
                first_name: "",
                last_name: "",
                is_superuser: admin,
                is_staff: admin,
                scan_directory: "",
            },
        )
        .await
        .expect("create user");
        lp_db::users::by_id(&self.db.pool, id)
            .await
            .expect("load user")
            .expect("user exists")
    }

    /// A valid access token for `user` (same format Django issues).
    pub fn token_for(&self, user: &User) -> String {
        lp_auth::jwt::mint_access(&self.state, user)
    }

    /// Send a raw request through the full app.
    pub async fn request(&self, req: Request<Body>) -> TestResponse {
        let res = self
            .app
            .clone()
            .oneshot(req)
            .await
            .expect("infallible service");
        let status = res.status();
        let headers = res.headers().clone();
        let body = res
            .into_body()
            .collect()
            .await
            .expect("read body")
            .to_bytes();
        TestResponse {
            status,
            headers,
            body,
        }
    }

    pub async fn send(
        &self,
        method: Method,
        path: &str,
        json: Option<&serde_json::Value>,
        token: Option<&str>,
    ) -> TestResponse {
        let mut b = Request::builder().method(method).uri(path);
        if let Some(t) = token {
            b = b.header("authorization", format!("Bearer {t}"));
        }
        let body = match json {
            Some(v) => {
                b = b.header("content-type", "application/json");
                Body::from(serde_json::to_vec(v).expect("json"))
            }
            None => Body::empty(),
        };
        self.request(b.body(body).expect("request")).await
    }

    pub async fn get(&self, path: &str, token: Option<&str>) -> TestResponse {
        self.send(Method::GET, path, None, token).await
    }

    pub async fn post_json(
        &self,
        path: &str,
        json: &serde_json::Value,
        token: Option<&str>,
    ) -> TestResponse {
        self.send(Method::POST, path, Some(json), token).await
    }

    pub async fn patch_json(
        &self,
        path: &str,
        json: &serde_json::Value,
        token: Option<&str>,
    ) -> TestResponse {
        self.send(Method::PATCH, path, Some(json), token).await
    }

    pub async fn delete(
        &self,
        path: &str,
        json: Option<&serde_json::Value>,
        token: Option<&str>,
    ) -> TestResponse {
        self.send(Method::DELETE, path, json, token).await
    }

    /// Drop the database (call at the end of every test).
    pub async fn cleanup(self) {
        let TestApp { db, state, .. } = self;
        drop(state);
        db.cleanup().await;
    }
}
