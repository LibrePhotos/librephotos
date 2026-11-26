pub mod changes;
pub mod migrate;
pub mod value;

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};

use rusqlite::hooks::{AuthAction, AuthContext, Authorization};
use rusqlite::{Connection, TransactionBehavior};
use serde::{Deserialize, Serialize};

use changes::ChangeHub;
use value::{CellRef, Param};

pub const FILE_NAME: &str = "local.db";

const STATEMENT_CACHE: usize = 256;

#[derive(Deserialize, Serialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Method {
    Run,
    All,
    Values,
    Get,
}

#[derive(Deserialize, Debug, Clone)]
pub struct Statement {
    pub sql: String,
    #[serde(default)]
    pub params: Vec<Param>,
    pub method: Method,
}

pub type Answer = Vec<u8>;

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DbInfo {
    pub path: Option<String>,
    pub applied: Vec<String>,
    pub wiped: bool,
    pub migration_error: Option<String>,
}

pub struct LocalDb {
    conn: Mutex<Connection>,
    touched: Arc<Mutex<BTreeSet<String>>>,
    hub: ChangeHub,
    path: Option<PathBuf>,
    applied: Vec<String>,
    wiped: bool,
    migration_error: Option<String>,
}

fn virtual_tables(conn: &Connection) -> rusqlite::Result<Vec<String>> {
    let mut st = conn.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND sql LIKE 'CREATE VIRTUAL TABLE%'",
    )?;
    st.query_map([], |r| r.get(0))?.collect()
}

fn configure(conn: &Connection) -> rusqlite::Result<()> {
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    conn.busy_timeout(std::time::Duration::from_secs(5))?;
    conn.set_prepared_statement_cache_capacity(STATEMENT_CACHE);
    Ok(())
}

fn first_keywords(sql: &str) -> (String, String) {
    let mut rest = sql;
    loop {
        rest = rest.trim_start();
        if let Some(r) = rest.strip_prefix("--") {
            rest = r.split_once('\n').map_or("", |(_, r)| r);
        } else if let Some(r) = rest.strip_prefix("/*") {
            rest = r.split_once("*/").map_or("", |(_, r)| r);
        } else {
            break;
        }
    }
    let mut words = rest
        .split(|c: char| !c.is_ascii_alphanumeric() && c != '_')
        .filter(|w| !w.is_empty())
        .map(|w| w.to_ascii_lowercase());
    (
        words.next().unwrap_or_default(),
        words.next().unwrap_or_default(),
    )
}

fn ends_transaction(sql: &str) -> bool {
    let (a, b) = first_keywords(sql);
    match a.as_str() {
        "begin" | "commit" | "end" => true,
        "rollback" => b != "to",
        _ => false,
    }
}

fn write_row(out: &mut Vec<u8>, row: &rusqlite::Row<'_>, cols: usize) -> Result<bool, String> {
    let mut tagged = false;
    out.push(b'[');
    for i in 0..cols {
        if i > 0 {
            out.push(b',');
        }
        let cell = CellRef(row.get_ref(i).map_err(|e| e.to_string())?);
        tagged |= cell.is_tagged();
        cell.write_json(out).map_err(|e| e.to_string())?;
    }
    out.push(b']');
    Ok(tagged)
}

fn step<'s>(rows: &'s mut rusqlite::Rows<'_>) -> Result<Option<&'s rusqlite::Row<'s>>, String> {
    rows.next().map_err(|e| e.to_string())
}

fn write_rows(
    out: &mut Vec<u8>,
    rows: &mut rusqlite::Rows<'_>,
    cols: usize,
    method: Method,
) -> Result<bool, String> {
    let mut tagged = false;
    match method {
        Method::Run => {
            while step(rows)?.is_some() {}
            out.extend_from_slice(b"[]");
        }
        Method::All | Method::Values => {
            out.push(b'[');
            let mut first = true;
            while let Some(row) = step(rows)? {
                if !first {
                    out.push(b',');
                }
                first = false;
                tagged |= write_row(out, row, cols)?;
            }
            out.push(b']');
        }
        Method::Get => {
            match step(rows)? {
                Some(row) => tagged = write_row(out, row, cols)?,
                None => out.extend_from_slice(b"null"),
            }
            while step(rows)?.is_some() {}
        }
    }
    Ok(tagged)
}

fn run_statement(conn: &Connection, st: &Statement, out: &mut Vec<u8>) -> Result<(), String> {
    let mut stmt = conn.prepare_cached(&st.sql).map_err(|e| e.to_string())?;
    let expected = stmt.parameter_count();
    if expected != st.params.len() {
        return Err(format!(
            "the statement takes {expected} parameters, got {}",
            st.params.len()
        ));
    }
    for (i, p) in st.params.iter().enumerate() {
        stmt.raw_bind_parameter(i + 1, p)
            .map_err(|e| e.to_string())?;
    }
    let cols = stmt.column_count();
    let columns = match st.method {
        Method::All | Method::Get => Some(
            serde_json::to_vec(&stmt.column_names().collect::<Vec<_>>())
                .map_err(|e| e.to_string())?,
        ),
        Method::Run | Method::Values => None,
    };
    let mut rows = stmt.raw_query();
    let start = out.len();
    out.extend_from_slice(b"{\"rows\":");
    match write_rows(out, &mut rows, cols, st.method) {
        Ok(tagged) => {
            drop(rows);
            if let Some(c) = columns {
                out.extend_from_slice(b",\"columns\":");
                out.extend_from_slice(&c);
            }
            if st.method == Method::Run {
                out.extend_from_slice(
                    format!(
                        ",\"changes\":{},\"lastInsertRowId\":{}",
                        conn.changes(),
                        conn.last_insert_rowid()
                    )
                    .as_bytes(),
                );
            }
            if tagged {
                out.extend_from_slice(b",\"tagged\":true");
            }
            out.push(b'}');
            Ok(())
        }
        Err(e) => {
            out.truncate(start);
            Err(e)
        }
    }
}

impl LocalDb {
    pub fn open(
        path: &Path,
        migrations: &[migrate::Migration],
        hub: ChangeHub,
    ) -> rusqlite::Result<LocalDb> {
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let conn = Connection::open(path)?;
        Self::with_connection(conn, Some(path.to_path_buf()), migrations, hub)
    }

    pub fn open_memory(
        migrations: &[migrate::Migration],
        hub: ChangeHub,
    ) -> rusqlite::Result<Self> {
        Self::with_connection(Connection::open_in_memory()?, None, migrations, hub)
    }

    fn with_connection(
        mut conn: Connection,
        path: Option<PathBuf>,
        migrations: &[migrate::Migration],
        hub: ChangeHub,
    ) -> rusqlite::Result<LocalDb> {
        configure(&conn)?;
        let outcome = migrate::run(&mut conn, migrations);
        if let Some(e) = &outcome.error {
            eprintln!("local database: {e}");
        }
        let applied = migrate::applied(&conn)?;
        let touched: Arc<Mutex<BTreeSet<String>>> = Arc::default();
        let sink = touched.clone();
        let shadows: Vec<String> = virtual_tables(&conn)?
            .into_iter()
            .map(|v| format!("{v}_"))
            .collect();
        conn.update_hook(Some(move |_action, _db: &str, table: &str, _rowid| {
            if !table.starts_with("sqlite_") && !shadows.iter().any(|s| table.starts_with(s)) {
                let mut t = sink.lock().unwrap_or_else(|e| e.into_inner());
                if !t.contains(table) {
                    t.insert(table.to_string());
                }
            }
        }))?;
        let mut dropping: Option<String> = None;
        conn.authorizer(Some(move |ctx: AuthContext<'_>| match ctx.action {
            AuthAction::DropTable { table_name }
            | AuthAction::DropTempTable { table_name }
            | AuthAction::DropVtable { table_name, .. }
            | AuthAction::DropView {
                view_name: table_name,
            }
            | AuthAction::DropTempView {
                view_name: table_name,
            } => {
                dropping = Some(table_name.to_string());
                Authorization::Allow
            }
            AuthAction::Delete { table_name } => {
                let drop = dropping.take();
                if table_name.starts_with("sqlite_") || drop.as_deref() == Some(table_name) {
                    Authorization::Allow
                } else {
                    Authorization::Ignore
                }
            }
            _ => {
                dropping = None;
                Authorization::Allow
            }
        }))?;
        Ok(LocalDb {
            conn: Mutex::new(conn),
            touched,
            hub,
            path,
            applied: applied.into_iter().map(|(tag, _)| tag).collect(),
            wiped: outcome.wiped,
            migration_error: outcome.error.map(|e| e.to_string()),
        })
    }

    fn lock(&self) -> MutexGuard<'_, Connection> {
        self.conn.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn info(&self) -> DbInfo {
        DbInfo {
            path: self.path.as_ref().map(|p| p.to_string_lossy().into_owned()),
            applied: self.applied.clone(),
            wiped: self.wiped,
            migration_error: self.migration_error.clone(),
        }
    }

    fn settle(&self, committed: bool) {
        let tables = std::mem::take(&mut *self.touched.lock().unwrap_or_else(|e| e.into_inner()));
        if committed && !tables.is_empty() {
            self.hub.notify(tables);
        }
    }

    pub fn exec(&self, st: &Statement) -> Result<Answer, String> {
        let conn = self.lock();
        let mut out = Vec::new();
        let result = run_statement(&conn, st, &mut out).map(|()| out);
        if !conn.is_autocommit() {
            let _ = conn.execute_batch("ROLLBACK");
            self.settle(false);
            return Err(
                "a transaction cannot stay open between calls: use db_batch for several statements"
                    .into(),
            );
        }
        self.settle(result.is_ok());
        result
    }

    pub fn batch(&self, statements: &[Statement]) -> Result<Answer, String> {
        if let Some(i) = statements.iter().position(|s| ends_transaction(&s.sql)) {
            return Err(format!(
                "statement {i}: a batch is one transaction already, it cannot begin or end one"
            ));
        }
        let mut conn = self.lock();
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|e| e.to_string())?;
        let mut out = vec![b'['];
        for (i, st) in statements.iter().enumerate() {
            if i > 0 {
                out.push(b',');
            }
            match run_statement(&tx, st, &mut out) {
                Ok(()) => {}
                Err(e) => {
                    drop(tx);
                    self.settle(false);
                    return Err(format!("statement {i}: {e}"));
                }
            }
        }
        out.push(b']');
        let committed = tx.commit().map_err(|e| e.to_string());
        self.settle(committed.is_ok());
        committed.map(|()| out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::Duration;

    fn st(sql: &str, params: &str, method: Method) -> Statement {
        Statement {
            sql: sql.into(),
            params: serde_json::from_str(params).unwrap(),
            method,
        }
    }

    fn db_with(hub: ChangeHub) -> LocalDb {
        let m = migrate::parse(
            r#"[{"tag":"0000_init","statements":[
            "CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT, n INTEGER, r REAL, b BLOB)",
            "CREATE TABLE u (k TEXT PRIMARY KEY, v TEXT) WITHOUT ROWID"]}]"#,
        )
        .unwrap();
        LocalDb::open_memory(&m, hub).unwrap()
    }

    fn db() -> LocalDb {
        db_with(ChangeHub::spawn(Duration::from_millis(5), |_| ()))
    }

    fn json(r: &[u8]) -> String {
        String::from_utf8(r.to_vec()).unwrap()
    }

    #[test]
    fn answers_in_sqlite_proxy_shapes() {
        let db = db();
        let ins = db
            .exec(&st(
                "INSERT INTO t (name, n) VALUES (?, ?), (?, ?)",
                r#"["a", 1, "b", 2]"#,
                Method::Run,
            ))
            .unwrap();
        assert_eq!(json(&ins), r#"{"rows":[],"changes":2,"lastInsertRowId":2}"#);
        let all = db
            .exec(&st(
                "SELECT id, name, n FROM t ORDER BY id",
                "[]",
                Method::All,
            ))
            .unwrap();
        assert_eq!(
            json(&all),
            r#"{"rows":[[1,"a",1],[2,"b",2]],"columns":["id","name","n"]}"#
        );
        let values = db
            .exec(&st("SELECT name FROM t ORDER BY id", "[]", Method::Values))
            .unwrap();
        assert_eq!(json(&values), r#"{"rows":[["a"],["b"]]}"#);
        let get = db
            .exec(&st("SELECT name FROM t WHERE id = ?", "[2]", Method::Get))
            .unwrap();
        assert_eq!(json(&get), r#"{"rows":["b"],"columns":["name"]}"#);
        let none = db
            .exec(&st("SELECT name FROM t WHERE id = ?", "[9]", Method::Get))
            .unwrap();
        assert_eq!(json(&none), r#"{"rows":null,"columns":["name"]}"#);
        let ret = db
            .exec(&st(
                "INSERT INTO t (name) VALUES ('c'), ('d') RETURNING name",
                "[]",
                Method::Get,
            ))
            .unwrap();
        assert_eq!(json(&ret), r#"{"rows":["c"],"columns":["name"]}"#);
        let n = db
            .exec(&st("SELECT COUNT(*) AS n FROM t", "[]", Method::Get))
            .unwrap();
        assert_eq!(json(&n), r#"{"rows":[4],"columns":["n"]}"#);
        assert!(
            db.exec(&st("SELECT ?", "[]", Method::All))
                .unwrap_err()
                .contains("1 parameters")
        );
        assert!(db.exec(&st("SELEC 1", "[]", Method::All)).is_err());
        for sql in [
            "CREATE TABLE tmp (x)",
            "CREATE VIEW v AS SELECT * FROM tmp",
            "DROP VIEW v",
            "DROP TABLE tmp",
        ] {
            db.exec(&st(sql, "[]", Method::Run)).unwrap();
        }
        let left = db
            .exec(&st(
                "SELECT COUNT(*) AS n FROM sqlite_master WHERE name IN ('tmp', 'v')",
                "[]",
                Method::Get,
            ))
            .unwrap();
        assert_eq!(
            json(&left),
            r#"{"rows":[0],"columns":["n"]}"#,
            "DROP really dropped"
        );
    }

    #[test]
    fn maps_values_faithfully() {
        let db = db();
        db.exec(&st(
            "INSERT INTO t (id, name, n, r, b) VALUES (?, ?, ?, ?, ?)",
            r#"[1, "ünï", {"$bigint":"9007199254740993"}, 0.1, {"$blob":"AP8="}]"#,
            Method::Run,
        ))
        .unwrap();
        db.exec(&st(
            "INSERT INTO t (id, name, n, r, b) VALUES (2, NULL, ?, ?, NULL)",
            r#"[-9007199254740991, {"$real":"-Infinity"}]"#,
            Method::Run,
        ))
        .unwrap();
        let r = db
            .exec(&st(
                "SELECT name, n, r, b, typeof(n), typeof(b) FROM t ORDER BY id",
                "[]",
                Method::All,
            ))
            .unwrap();
        assert_eq!(
            json(&r),
            r#"{"rows":[["ünï",{"$bigint":"9007199254740993"},0.1,{"$blob":"AP8="},"integer","blob"],[null,-9007199254740991,{"$real":"-Infinity"},null,"integer","null"]],"columns":["name","n","r","b","typeof(n)","typeof(b)"],"tagged":true}"#
        );
        let b = db
            .exec(&st("SELECT ? AS a, ? AS b", "[true, false]", Method::Get))
            .unwrap();
        assert_eq!(json(&b), r#"{"rows":[1,0],"columns":["a","b"]}"#);
    }

    #[test]
    fn batches_are_all_or_nothing() {
        let db = db();
        let ok = db
            .batch(&[
                st(
                    "INSERT INTO t (id, name) VALUES (1, 'a')",
                    "[]",
                    Method::Run,
                ),
                st(
                    "INSERT INTO t (id, name) VALUES (2, 'b')",
                    "[]",
                    Method::Run,
                ),
                st("SELECT COUNT(*) AS n FROM t", "[]", Method::Get),
                st("SELECT id FROM t ORDER BY id", "[]", Method::Values),
            ])
            .unwrap();
        assert_eq!(
            json(&ok),
            r#"[{"rows":[],"changes":1,"lastInsertRowId":1},{"rows":[],"changes":1,"lastInsertRowId":2},{"rows":[2],"columns":["n"]},{"rows":[[1],[2]]}]"#
        );
        let err = db
            .batch(&[
                st(
                    "INSERT INTO t (id, name) VALUES (3, 'c')",
                    "[]",
                    Method::Run,
                ),
                st(
                    "INSERT INTO t (id, name) VALUES (1, 'dup')",
                    "[]",
                    Method::Run,
                ),
            ])
            .unwrap_err();
        assert!(err.starts_with("statement 1:"), "{err}");
        let n = db
            .exec(&st("SELECT COUNT(*) AS n FROM t", "[]", Method::Get))
            .unwrap();
        assert_eq!(
            json(&n),
            r#"{"rows":[2],"columns":["n"]}"#,
            "the first insert was rolled back"
        );
        assert!(db.batch(&[st("COMMIT", "[]", Method::Run)]).is_err());
        assert!(
            db.batch(&[st("/* x */ begin immediate", "[]", Method::Run)])
                .is_err()
        );
        db.batch(&[
            st("SAVEPOINT a", "[]", Method::Run),
            st("INSERT INTO t (id) VALUES (5)", "[]", Method::Run),
            st("ROLLBACK TO a", "[]", Method::Run),
            st("RELEASE a", "[]", Method::Run),
        ])
        .unwrap();
        assert_eq!(
            json(
                &db.exec(&st("SELECT COUNT(*) AS n FROM t", "[]", Method::Get))
                    .unwrap()
            ),
            r#"{"rows":[2],"columns":["n"]}"#
        );
    }

    #[test]
    fn no_transaction_outlives_a_call() {
        let db = db();
        let err = db.exec(&st("BEGIN", "[]", Method::Run)).unwrap_err();
        assert!(err.contains("db_batch"), "{err}");
        db.exec(&st("INSERT INTO t (id) VALUES (1)", "[]", Method::Run))
            .unwrap();
        assert!(db.lock().is_autocommit());
    }

    #[test]
    fn reports_touched_tables_once_committed() {
        let (tx, rx) = mpsc::channel();
        let db = db_with(ChangeHub::spawn(Duration::from_millis(150), move |t| {
            tx.send(t).unwrap();
        }));
        let wait = || rx.recv_timeout(Duration::from_secs(2)).unwrap();
        db.exec(&st("INSERT INTO t (id) VALUES (1)", "[]", Method::Run))
            .unwrap();
        db.exec(&st("INSERT INTO u VALUES ('k', 'v')", "[]", Method::Run))
            .unwrap();
        db.exec(&st("UPDATE t SET name = 'x'", "[]", Method::Run))
            .unwrap();
        assert_eq!(wait(), vec!["t".to_string()]);
        let _ = db.batch(&[
            st("INSERT INTO t (id) VALUES (2)", "[]", Method::Run),
            st("INSERT INTO t (id) VALUES (1)", "[]", Method::Run),
        ]);
        db.exec(&st("SELECT * FROM t", "[]", Method::All)).unwrap();
        assert!(rx.recv_timeout(Duration::from_millis(300)).is_err());
        db.exec(&st("DELETE FROM t", "[]", Method::Run)).unwrap();
        assert_eq!(wait(), vec!["t".to_string()]);
        let n = db
            .exec(&st("SELECT COUNT(*) AS n FROM t", "[]", Method::Get))
            .unwrap();
        assert_eq!(json(&n), r#"{"rows":[0],"columns":["n"]}"#);
    }

    #[test]
    fn the_package_schema_reports_tables_not_its_search_index() {
        let (tx, rx) = mpsc::channel();
        let hub = ChangeHub::spawn(Duration::from_millis(20), move |t| {
            tx.send(t).unwrap();
        });
        let db = LocalDb::open_memory(&migrate::bundled(), hub).unwrap();
        assert!(db.info().migration_error.is_none());
        db.exec(&st(
            "INSERT INTO local_asset (id, uri, name, type, created_at, bucket_day) VALUES (?, ?, ?, 'image', 1, '2023-03-15')",
            r#"["C:/a.jpg", "C:/a.jpg", "a.jpg"]"#,
            Method::Run,
        ))
        .unwrap();
        assert_eq!(
            rx.recv_timeout(Duration::from_secs(2)).unwrap(),
            vec!["local_asset".to_string()]
        );
        let hit = db
            .exec(&st(
                "SELECT la.name AS name FROM local_asset_fts JOIN local_asset la ON la.rowid = local_asset_fts.rowid WHERE local_asset_fts MATCH ?",
                r#"["\"march\"*"]"#,
                Method::All,
            ))
            .unwrap();
        assert_eq!(json(&hit), r#"{"rows":[["a.jpg"]],"columns":["name"]}"#);
    }

    #[test]
    fn keywords() {
        assert!(ends_transaction("  COMMIT;"));
        assert!(ends_transaction("-- c\nEND TRANSACTION"));
        assert!(ends_transaction("rollback"));
        assert!(!ends_transaction("ROLLBACK TO sp1"));
        assert!(!ends_transaction("SELECT 'begin'"));
        assert!(!ends_transaction("beginning"));
    }
}
