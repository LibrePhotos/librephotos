//! SQLite connections (design §3): WAL, `synchronous=NORMAL`,
//! `foreign_keys=ON`, `busy_timeout`, a `query_only` reader pool and a
//! single-connection writer pool, plus the `now()` SQL function.

use std::ffi::{c_char, c_int, c_void};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use libsqlite3_sys as ffi;
use sqlx::sqlite::{
    SqliteConnectOptions, SqliteConnection, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous,
};

use super::codec::DjDateTime;
use super::config::{Backend, DbSettings};
use super::exec::{Db, Lite};

/// How to open a SQLite database.
#[derive(Debug, Clone)]
pub struct LiteOptions {
    pub path: PathBuf,
    /// `busy_timeout` (`LP_SQLITE_BUSY_MS`).
    pub busy_ms: u64,
    /// Reader connections (`LP_DB_POOL`).
    pub readers: u32,
    /// Create the file if it does not exist (fresh `migrate`).
    pub create: bool,
}

impl LiteOptions {
    pub fn new(path: impl Into<PathBuf>) -> LiteOptions {
        LiteOptions {
            path: path.into(),
            busy_ms: 10_000,
            readers: 4,
            create: false,
        }
    }

    pub fn from_settings(s: &DbSettings) -> LiteOptions {
        LiteOptions {
            path: s.sqlite_path.clone(),
            busy_ms: s.busy_ms,
            readers: s.readers,
            create: false,
        }
    }
}

/// Connect options shared by readers and the writer.
pub fn connect_options(path: &Path, busy_ms: u64) -> SqliteConnectOptions {
    SqliteConnectOptions::new()
        .filename(path)
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Normal)
        .foreign_keys(true)
        .busy_timeout(Duration::from_millis(busy_ms))
        .pragma("mmap_size", "134217728")
}

/// Opens the writer (first: it creates the file and switches it to WAL),
/// then the readers. Every connection gets the `now()` function.
pub async fn open(o: &LiteOptions) -> sqlx::Result<Lite> {
    let base = connect_options(&o.path, o.busy_ms);
    let write = SqlitePoolOptions::new()
        .max_connections(1)
        .min_connections(1)
        .acquire_timeout(Duration::from_secs(60))
        .after_connect(|conn, _meta| Box::pin(async move { install_now(conn).await }))
        .connect_with(
            base.clone()
                .create_if_missing(o.create)
                .optimize_on_close(true, None),
        )
        .await?;
    let read = SqlitePoolOptions::new()
        .max_connections(o.readers.max(1))
        .acquire_timeout(Duration::from_secs(30))
        .after_connect(|conn, _meta| Box::pin(async move { install_now(conn).await }))
        .connect_with(base.pragma("query_only", "1"))
        .await?;
    Ok(Lite::new(read, write))
}

impl Db {
    /// The database selected by `DB_BACKEND`: the Postgres pool from
    /// `lp_core::Config` (`DB_*`, `LP_DB_POOL`) or the SQLite file at
    /// `LP_SQLITE_PATH`.
    pub async fn connect(config: &lp_core::Config) -> anyhow::Result<Db> {
        let settings = DbSettings::from_env()?;
        Db::connect_with(config, &settings).await
    }

    pub async fn connect_with(config: &lp_core::Config, s: &DbSettings) -> anyhow::Result<Db> {
        Ok(match s.backend {
            Backend::Postgres => Db::Pg(crate::pool::connect(config).await?),
            Backend::Sqlite => Db::Lite(open(&LiteOptions::from_settings(s)).await?),
        })
    }

    /// Opens a SQLite database directly.
    pub async fn open_sqlite(o: &LiteOptions) -> sqlx::Result<Db> {
        Ok(Db::Lite(open(o).await?))
    }
}

// ------------------------------------------------------------------ now()

/// Per-connection state of `now()`: the value fixed for the current
/// transaction, cleared by the commit / rollback hooks.
struct NowState {
    tx_now: Mutex<Option<String>>,
}

impl NowState {
    fn clear(&self) {
        *self.tx_now.lock().unwrap_or_else(|e| e.into_inner()) = None;
    }
}

/// Registers `now()` on a connection: Django's datetime text
/// (`YYYY-MM-DD HH:MM:SS[.ffffff]`, UTC). Inside an explicit transaction it
/// returns the same value until COMMIT / ROLLBACK (Postgres: transaction
/// start time); in autocommit mode each call reads the clock.
///
/// Installs the connection's commit and rollback hooks, so
/// `LockedSqliteHandle::set_commit_hook` / `set_rollback_hook` must not be
/// used on these connections.
pub async fn install_now(conn: &mut SqliteConnection) -> sqlx::Result<()> {
    let mut handle = conn.lock_handle().await?;
    let db = handle.as_raw_handle().as_ptr();
    let state = Box::into_raw(Box::new(NowState {
        tx_now: Mutex::new(None),
    }))
    .cast::<c_void>();
    // SAFETY: `db` is a live connection handle locked for this task. SQLite
    // owns `state` from here on: `destroy_now` frees it when the function is
    // replaced or the connection closes, after which no hook fires.
    let rc = unsafe {
        let rc = ffi::sqlite3_create_function_v2(
            db,
            c"now".as_ptr(),
            0,
            ffi::SQLITE_UTF8,
            state,
            Some(now_fn),
            None,
            None,
            Some(destroy_now),
        );
        if rc == ffi::SQLITE_OK {
            ffi::sqlite3_commit_hook(db, Some(on_commit), state);
            ffi::sqlite3_rollback_hook(db, Some(on_rollback), state);
        }
        rc
    };
    if rc != ffi::SQLITE_OK {
        return Err(sqlx::Error::Protocol(format!(
            "sqlite3_create_function_v2(now) failed: {rc}"
        )));
    }
    Ok(())
}

unsafe extern "C" fn now_fn(
    ctx: *mut ffi::sqlite3_context,
    _argc: c_int,
    _argv: *mut *mut ffi::sqlite3_value,
) {
    // SAFETY: SQLite passes a valid context whose user data is the
    // `NowState` registered in `install_now`.
    unsafe {
        let state = &*(ffi::sqlite3_user_data(ctx) as *const NowState);
        let in_tx = ffi::sqlite3_get_autocommit(ffi::sqlite3_context_db_handle(ctx)) == 0;
        let text = if in_tx {
            let mut g = state.tx_now.lock().unwrap_or_else(|e| e.into_inner());
            g.get_or_insert_with(|| DjDateTime::now().to_string())
                .clone()
        } else {
            DjDateTime::now().to_string()
        };
        ffi::sqlite3_result_text(
            ctx,
            text.as_ptr() as *const c_char,
            text.len() as c_int,
            ffi::SQLITE_TRANSIENT(),
        );
    }
}

unsafe extern "C" fn on_commit(p: *mut c_void) -> c_int {
    // SAFETY: `p` is the `NowState` of this connection (alive until close).
    unsafe { (*(p as *const NowState)).clear() };
    0
}

unsafe extern "C" fn on_rollback(p: *mut c_void) {
    // SAFETY: as in `on_commit`.
    unsafe { (*(p as *const NowState)).clear() };
}

unsafe extern "C" fn destroy_now(p: *mut c_void) {
    // SAFETY: `p` came from `Box::into_raw` in `install_now`; SQLite calls
    // this exactly once.
    drop(unsafe { Box::from_raw(p as *mut NowState) });
}
