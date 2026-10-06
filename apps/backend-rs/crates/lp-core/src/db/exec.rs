//! Handles: [`Db`] (pool), [`Tx`] (transaction), [`Conn`] / [`PoolConn`]
//! (one connection) and the [`Exec`] trait that every query method takes,
//! the `PgExecutor` of this layer.

use std::ops::{Deref, DerefMut};

use sqlx::pool::PoolConnection;
use sqlx::{PgConnection, PgPool, Postgres, Sqlite, SqliteConnection, SqlitePool, Transaction};

/// Which SQL dialect a handle speaks.
#[derive(Debug, Copy, Clone, PartialEq, Eq, Hash)]
pub enum Dialect {
    Pg,
    Sqlite,
}

impl Dialect {
    pub fn is_pg(self) -> bool {
        self == Dialect::Pg
    }
    pub fn is_sqlite(self) -> bool {
        self == Dialect::Sqlite
    }
}

/// The two SQLite pools: `read` (`LP_DB_POOL` connections, `query_only`) and
/// `write` (exactly one connection; every transaction is `BEGIN IMMEDIATE`).
#[derive(Clone, Debug)]
pub struct Lite {
    pub(crate) read: SqlitePool,
    pub(crate) write: SqlitePool,
}

impl Lite {
    pub fn new(read: SqlitePool, write: SqlitePool) -> Lite {
        Lite { read, write }
    }
    pub fn read_pool(&self) -> &SqlitePool {
        &self.read
    }
    pub fn write_pool(&self) -> &SqlitePool {
        &self.write
    }
}

/// A database: a Postgres pool or the SQLite reader/writer pair.
///
/// `&Db` is an [`Exec`]: on SQLite a statement that cannot write (see
/// [`super::sql::is_read_only`]) runs on a reader, anything else on the
/// writer. Never use `&Db` for a write while this task holds the writer in a
/// [`Tx`] / [`Db::acquire`]: the single writer would wait for itself.
#[derive(Clone, Debug)]
pub enum Db {
    Pg(PgPool),
    Lite(Lite),
}

impl From<PgPool> for Db {
    fn from(p: PgPool) -> Db {
        Db::Pg(p)
    }
}

impl From<Lite> for Db {
    fn from(l: Lite) -> Db {
        Db::Lite(l)
    }
}

impl Db {
    pub fn dialect(&self) -> Dialect {
        match self {
            Db::Pg(_) => Dialect::Pg,
            Db::Lite(_) => Dialect::Sqlite,
        }
    }

    /// The Postgres pool, for Postgres-only code (`PgListener`, `COPY`).
    pub fn as_pg(&self) -> Option<&PgPool> {
        match self {
            Db::Pg(p) => Some(p),
            Db::Lite(_) => None,
        }
    }

    pub fn as_lite(&self) -> Option<&Lite> {
        match self {
            Db::Pg(_) => None,
            Db::Lite(l) => Some(l),
        }
    }

    /// Identifies the database (Postgres `host:port/name`, SQLite
    /// `sqlite:<file>`), e.g. to key per-database caches.
    pub fn key(&self) -> String {
        match self {
            Db::Pg(p) => {
                let o = p.connect_options();
                format!(
                    "{}:{}/{}",
                    o.get_host(),
                    o.get_port(),
                    o.get_database().unwrap_or_default()
                )
            }
            Db::Lite(l) => format!(
                "sqlite:{}",
                l.write.connect_options().get_filename().display()
            ),
        }
    }

    /// Starts a transaction. On SQLite it takes the single writer connection
    /// and runs `BEGIN IMMEDIATE` (the write lock is taken up front, as
    /// Django's `transaction_mode=IMMEDIATE` does).
    pub async fn begin(&self) -> sqlx::Result<Tx> {
        Ok(match self {
            Db::Pg(p) => Tx::new(Conn(ConnInner::PgTx(p.begin().await?))),
            Db::Lite(l) => Tx::new(Conn(ConnInner::LiteTx(
                l.write.begin_with("BEGIN IMMEDIATE").await?,
            ))),
        })
    }

    /// One pooled connection, autocommit. On SQLite this is the writer (it
    /// can read and write); hold it briefly. Use [`Db::acquire_read`] for long
    /// read-only work.
    pub async fn acquire(&self) -> sqlx::Result<PoolConn> {
        Ok(PoolConn(match self {
            Db::Pg(p) => Conn(ConnInner::Pg(p.acquire().await?)),
            Db::Lite(l) => Conn(ConnInner::Lite(l.write.acquire().await?)),
        }))
    }

    /// A read-only connection (a SQLite reader; any Postgres connection).
    pub async fn acquire_read(&self) -> sqlx::Result<PoolConn> {
        Ok(PoolConn(match self {
            Db::Pg(p) => Conn(ConnInner::Pg(p.acquire().await?)),
            Db::Lite(l) => Conn(ConnInner::Lite(l.read.acquire().await?)),
        }))
    }

    /// An [`Exec`] that always uses a reader on SQLite (writes fail there
    /// with "attempt to write a readonly database"). Same as `self` on Postgres.
    pub fn read(&self) -> ReadOnly<'_> {
        ReadOnly(self)
    }

    pub async fn close(&self) {
        match self {
            Db::Pg(p) => p.close().await,
            Db::Lite(l) => {
                l.read.close().await;
                l.write.close().await;
            }
        }
    }
}

#[derive(Debug)]
enum ConnInner {
    Pg(PoolConnection<Postgres>),
    PgTx(Transaction<'static, Postgres>),
    Lite(PoolConnection<Sqlite>),
    LiteTx(Transaction<'static, Sqlite>),
}

/// One connection (pooled, or the connection of a [`Tx`]): the `PgConnection`
/// of this layer. `&mut *tx` and `&mut *pool_conn` give a `&mut Conn`.
#[derive(Debug)]
pub struct Conn(ConnInner);

impl Conn {
    pub fn dialect(&self) -> Dialect {
        match self.0 {
            ConnInner::Pg(_) | ConnInner::PgTx(_) => Dialect::Pg,
            ConnInner::Lite(_) | ConnInner::LiteTx(_) => Dialect::Sqlite,
        }
    }

    /// The raw Postgres connection, for Postgres-only statements.
    pub fn as_pg(&mut self) -> Option<&mut PgConnection> {
        match &mut self.0 {
            ConnInner::Pg(c) => Some(&mut **c),
            ConnInner::PgTx(t) => Some(&mut **t),
            _ => None,
        }
    }

    /// The raw SQLite connection.
    pub fn as_lite(&mut self) -> Option<&mut SqliteConnection> {
        match &mut self.0 {
            ConnInner::Lite(c) => Some(&mut **c),
            ConnInner::LiteTx(t) => Some(&mut **t),
            _ => None,
        }
    }

    fn target(&mut self) -> Target<'_> {
        match &mut self.0 {
            ConnInner::Pg(c) => Target::PgConn(c),
            ConnInner::PgTx(t) => Target::PgConn(t),
            ConnInner::Lite(c) => Target::LiteConn(c),
            ConnInner::LiteTx(t) => Target::LiteConn(t),
        }
    }
}

/// A pooled connection from [`Db::acquire`]; derefs to [`Conn`].
#[derive(Debug)]
pub struct PoolConn(Conn);

impl Deref for PoolConn {
    type Target = Conn;
    fn deref(&self) -> &Conn {
        &self.0
    }
}

impl DerefMut for PoolConn {
    fn deref_mut(&mut self) -> &mut Conn {
        &mut self.0
    }
}

/// A transaction; derefs to [`Conn`] (`&mut *tx`). Dropped without
/// [`Tx::commit`] it rolls back, like sqlx's `Transaction`.
#[derive(Debug)]
pub struct Tx(Conn);

impl Tx {
    fn new(c: Conn) -> Tx {
        Tx(c)
    }

    pub async fn commit(self) -> sqlx::Result<()> {
        match self.0.0 {
            ConnInner::PgTx(t) => t.commit().await,
            ConnInner::LiteTx(t) => t.commit().await,
            _ => unreachable!("Tx always holds a transaction"),
        }
    }

    pub async fn rollback(self) -> sqlx::Result<()> {
        match self.0.0 {
            ConnInner::PgTx(t) => t.rollback().await,
            ConnInner::LiteTx(t) => t.rollback().await,
            _ => unreachable!("Tx always holds a transaction"),
        }
    }
}

impl Deref for Tx {
    type Target = Conn;
    fn deref(&self) -> &Conn {
        &self.0
    }
}

impl DerefMut for Tx {
    fn deref_mut(&mut self) -> &mut Conn {
        &mut self.0
    }
}

/// Where one statement runs (what an [`Exec`] resolves to).
#[derive(Debug)]
pub enum Target<'e> {
    PgPool(&'e PgPool),
    PgConn(&'e mut PgConnection),
    /// `&Db` on SQLite; `read_only` forces the reader pool.
    LitePool {
        lite: &'e Lite,
        read_only: bool,
    },
    LiteConn(&'e mut SqliteConnection),
}

impl Target<'_> {
    pub fn dialect(&self) -> Dialect {
        match self {
            Target::PgPool(_) | Target::PgConn(_) => Dialect::Pg,
            Target::LitePool { .. } | Target::LiteConn(_) => Dialect::Sqlite,
        }
    }
}

/// The executor argument of every query method (`PgExecutor<'e>` of this
/// layer): `&Db`, `db.read()`, `&mut Conn` (`&mut *tx`, `&mut *conn`),
/// `&mut Tx`, `&mut PoolConn`, and, for a gradual port, `&PgPool` and
/// `&mut PgConnection`. Like sqlx executors it is consumed by one call;
/// reborrow (`&mut *conn`) to run several statements.
pub trait Exec<'e>: Send + Sized {
    fn dialect(&self) -> Dialect;
    fn into_target(self) -> Target<'e>;
}

impl<'e> Exec<'e> for &'e Db {
    fn dialect(&self) -> Dialect {
        Db::dialect(self)
    }
    fn into_target(self) -> Target<'e> {
        match self {
            Db::Pg(p) => Target::PgPool(p),
            Db::Lite(l) => Target::LitePool {
                lite: l,
                read_only: false,
            },
        }
    }
}

/// [`Db::read`]: always a reader on SQLite.
#[derive(Debug, Clone, Copy)]
pub struct ReadOnly<'a>(&'a Db);

impl<'e> Exec<'e> for ReadOnly<'e> {
    fn dialect(&self) -> Dialect {
        self.0.dialect()
    }
    fn into_target(self) -> Target<'e> {
        match self.0 {
            Db::Pg(p) => Target::PgPool(p),
            Db::Lite(l) => Target::LitePool {
                lite: l,
                read_only: true,
            },
        }
    }
}

impl<'e> Exec<'e> for &'e mut Conn {
    fn dialect(&self) -> Dialect {
        Conn::dialect(self)
    }
    fn into_target(self) -> Target<'e> {
        self.target()
    }
}

impl<'e> Exec<'e> for &'e mut Tx {
    fn dialect(&self) -> Dialect {
        self.0.dialect()
    }
    fn into_target(self) -> Target<'e> {
        self.0.target()
    }
}

impl<'e> Exec<'e> for &'e mut PoolConn {
    fn dialect(&self) -> Dialect {
        self.0.dialect()
    }
    fn into_target(self) -> Target<'e> {
        self.0.target()
    }
}

impl<'e> Exec<'e> for &'e PgPool {
    fn dialect(&self) -> Dialect {
        Dialect::Pg
    }
    fn into_target(self) -> Target<'e> {
        Target::PgPool(self)
    }
}

impl<'e> Exec<'e> for &'e mut PgConnection {
    fn dialect(&self) -> Dialect {
        Dialect::Pg
    }
    fn into_target(self) -> Target<'e> {
        Target::PgConn(self)
    }
}

impl<'e> Exec<'e> for &'e mut SqliteConnection {
    fn dialect(&self) -> Dialect {
        Dialect::Sqlite
    }
    fn into_target(self) -> Target<'e> {
        Target::LiteConn(self)
    }
}
