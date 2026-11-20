//! The migration runner: applies `packages/local-db`'s ordered `migrations.json`
//! (`[{ "tag": "0000_init", "statements": ["CREATE TABLE ...", ...] }]`) at start-up, before the
//! window loads. Applied tags are kept in `__local_db_migrations(tag, applied_at)`; each
//! migration runs in its own transaction, so a failing one leaves the database exactly at the
//! migration before it, and the next start tries it again.

use std::collections::HashSet;
use std::fmt;

use rusqlite::{Connection, TransactionBehavior, params};
use serde::Deserialize;

/// The migrations the app applies. Phase 1 ships a fixture; with `packages/local-db` this is
/// `include_str!("../../../../../packages/local-db/migrations/migrations.json")`.
pub const MIGRATIONS_JSON: &str = include_str!("fixtures/migrations.json");

const BOOKKEEPING: &str = "CREATE TABLE IF NOT EXISTS __local_db_migrations (\
    tag TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)";

#[derive(Deserialize, Debug, Clone, PartialEq)]
pub struct Migration {
    pub tag: String,
    pub statements: Vec<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct MigrateError {
    /// The migration that failed (empty when the bookkeeping itself failed).
    pub tag: String,
    /// Its statement that failed.
    pub statement: Option<usize>,
    pub message: String,
}

impl fmt::Display for MigrateError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match (self.tag.as_str(), self.statement) {
            ("", _) => write!(f, "migrations: {}", self.message),
            (tag, Some(i)) => write!(f, "migration {tag}, statement {i}: {}", self.message),
            (tag, None) => write!(f, "migration {tag}: {}", self.message),
        }
    }
}

/// Parses a `migrations.json`; tags must be unique and non-empty.
pub fn parse(json: &str) -> Result<Vec<Migration>, String> {
    let list: Vec<Migration> =
        serde_json::from_str(json).map_err(|e| format!("migrations.json: {e}"))?;
    let mut seen = HashSet::new();
    for m in &list {
        if m.tag.is_empty() || !seen.insert(m.tag.as_str()) {
            return Err(format!(
                "migrations.json: empty or repeated tag {:?}",
                m.tag
            ));
        }
    }
    Ok(list)
}

/// The app's migrations ([`MIGRATIONS_JSON`]).
pub fn bundled() -> Vec<Migration> {
    parse(MIGRATIONS_JSON).unwrap_or_else(|e| {
        eprintln!("local database: {e}");
        Vec::new()
    })
}

/// Applied tags with their time (ms since the epoch), in the order they were applied.
pub fn applied(conn: &Connection) -> rusqlite::Result<Vec<(String, i64)>> {
    conn.execute(BOOKKEEPING, [])?;
    let mut st =
        conn.prepare("SELECT tag, applied_at FROM __local_db_migrations ORDER BY rowid")?;
    st.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?.collect()
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// Applies every migration whose tag is not recorded yet, in order, each in one transaction.
/// Returns the tags applied now; stops at the first failure.
pub fn apply(conn: &mut Connection, migrations: &[Migration]) -> Result<Vec<String>, MigrateError> {
    let bookkeeping = |e: rusqlite::Error| MigrateError {
        tag: String::new(),
        statement: None,
        message: e.to_string(),
    };
    let done: HashSet<String> = applied(conn)
        .map_err(bookkeeping)?
        .into_iter()
        .map(|(t, _)| t)
        .collect();
    let mut now = Vec::new();
    for m in migrations.iter().filter(|m| !done.contains(&m.tag)) {
        let fail = |statement: Option<usize>, e: rusqlite::Error| MigrateError {
            tag: m.tag.clone(),
            statement,
            message: e.to_string(),
        };
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|e| fail(None, e))?;
        for (i, sql) in m.statements.iter().enumerate() {
            tx.execute_batch(sql).map_err(|e| fail(Some(i), e))?;
        }
        tx.execute(
            "INSERT INTO __local_db_migrations (tag, applied_at) VALUES (?1, ?2)",
            params![m.tag, now_ms()],
        )
        .map_err(|e| fail(None, e))?;
        tx.commit().map_err(|e| fail(None, e))?;
        now.push(m.tag.clone());
    }
    Ok(now)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tables(conn: &Connection) -> Vec<String> {
        let mut st = conn
            .prepare(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' \
                 ORDER BY name",
            )
            .unwrap();
        st.query_map([], |r| r.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap()
    }

    fn m(tag: &str, statements: &[&str]) -> Migration {
        Migration {
            tag: tag.into(),
            statements: statements.iter().map(|s| s.to_string()).collect(),
        }
    }

    #[test]
    fn the_bundled_file_parses() {
        assert!(!parse(MIGRATIONS_JSON).unwrap().is_empty());
        assert!(parse(r#"[{"tag":"a","statements":[]},{"tag":"a","statements":[]}]"#).is_err());
        assert!(parse(r#"[{"tag":"","statements":[]}]"#).is_err());
        assert!(parse("{}").is_err());
    }

    #[test]
    fn applies_once_in_order() {
        let mut conn = Connection::open_in_memory().unwrap();
        let first = vec![m("0000_a", &["CREATE TABLE a (x INTEGER)"])];
        assert_eq!(apply(&mut conn, &first).unwrap(), ["0000_a"]);
        assert_eq!(apply(&mut conn, &first).unwrap(), Vec::<String>::new());
        let mut both = first.clone();
        both.push(m(
            "0001_b",
            &["CREATE TABLE b (y TEXT)", "INSERT INTO a VALUES (1)"],
        ));
        assert_eq!(apply(&mut conn, &both).unwrap(), ["0001_b"]);
        assert_eq!(apply(&mut conn, &both).unwrap(), Vec::<String>::new());
        assert_eq!(tables(&conn), ["__local_db_migrations", "a", "b"]);
        let tags: Vec<_> = applied(&conn).unwrap().into_iter().map(|t| t.0).collect();
        assert_eq!(tags, ["0000_a", "0001_b"]);
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM a", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1, "the data statement ran once");
    }

    #[test]
    fn a_failing_migration_rolls_back_and_stops() {
        let dir = std::env::temp_dir().join(format!("lpview-migrate-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("local.db");
        let good = m("0000_a", &["CREATE TABLE a (x INTEGER)"]);
        let bad = m(
            "0001_bad",
            &[
                "CREATE TABLE b (y TEXT)",
                "INSERT INTO a VALUES (1)",
                "ALTER TABLE nope ADD COLUMN z",
            ],
        );
        let later = m("0002_c", &["CREATE TABLE c (z TEXT)"]);
        {
            let mut conn = Connection::open(&path).unwrap();
            let err = apply(&mut conn, &[good.clone(), bad.clone(), later.clone()]).unwrap_err();
            assert_eq!((err.tag.as_str(), err.statement), ("0001_bad", Some(2)));
            assert!(err.to_string().contains("no such table"), "{err}");
            assert_eq!(tables(&conn), ["__local_db_migrations", "a"]);
            let n: i64 = conn
                .query_row("SELECT COUNT(*) FROM a", [], |r| r.get(0))
                .unwrap();
            assert_eq!(n, 0);
        }
        // Next start, with the migration fixed: it and the ones after it apply.
        let fixed = m(
            "0001_bad",
            &["CREATE TABLE b (y TEXT)", "INSERT INTO a VALUES (1)"],
        );
        let mut conn = Connection::open(&path).unwrap();
        assert_eq!(
            apply(&mut conn, &[good, fixed, later]).unwrap(),
            ["0001_bad", "0002_c"]
        );
        assert_eq!(tables(&conn), ["__local_db_migrations", "a", "b", "c"]);
        drop(conn);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
