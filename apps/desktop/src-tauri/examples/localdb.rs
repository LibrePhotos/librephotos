use std::time::{Duration, Instant};

use librephotos_viewer_lib::localdb::changes::ChangeHub;
use librephotos_viewer_lib::localdb::{LocalDb, Method, Statement};

const COLS: &str = "id, image_hash, owner_id, timestamp, added_on, last_modified, type, rating, \
    is_favorite, hidden, aspect_ratio, latitude, longitude, search_location, bucket_day";

fn row_json(i: usize) -> String {
    let ts = 1_600_000_000_000i64 + i as i64 * 60_000;
    format!(
        r#""photo-{i:08}-0000-0000-000000000000","{:032x}1",1,{ts},{},{},"{}",{},{},false,1.5,{},{},{},"2020-09-13""#,
        (i as u128).wrapping_mul(2654435761),
        ts + 5000,
        ts + 9000,
        if i.is_multiple_of(17) {
            "video"
        } else {
            "photo"
        },
        i % 6,
        i.is_multiple_of(11),
        48.1 + (i % 100) as f64 / 1000.0,
        11.5 + (i % 100) as f64 / 1000.0,
        if i.is_multiple_of(3) {
            r#""Munich, Bavaria, Germany""#
        } else {
            "null"
        },
    )
}

fn median(mut v: Vec<Duration>) -> Duration {
    v.sort();
    v[v.len() / 2]
}

fn main() {
    let dir = std::env::temp_dir().join(format!("lpview-localdb-bench-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let hub = ChangeHub::spawn(Duration::from_millis(40), |_| ());
    let db = LocalDb::open(&dir.join("local.db"), &[], hub).unwrap();
    let run = |sql: &str| {
        db.exec(&Statement {
            sql: sql.into(),
            params: vec![],
            method: Method::Run,
        })
        .unwrap();
    };
    run(
        "CREATE TABLE p (id TEXT PRIMARY KEY NOT NULL, image_hash TEXT NOT NULL, owner_id INTEGER NOT NULL, \
         timestamp INTEGER, added_on INTEGER NOT NULL, last_modified INTEGER NOT NULL, type TEXT NOT NULL, \
         rating INTEGER NOT NULL DEFAULT 0, is_favorite INTEGER NOT NULL DEFAULT 0, hidden INTEGER NOT NULL DEFAULT 0, \
         aspect_ratio REAL, latitude REAL, longitude REAL, search_location TEXT, bucket_day TEXT NOT NULL)",
    );
    run("CREATE INDEX p_ts ON p (timestamp)");
    let insert = format!("INSERT INTO p ({COLS}) VALUES ({})", ["?"; 15].join(", "));

    let mut parse = Vec::new();
    let mut write = Vec::new();
    for b in 0..25 {
        let json = format!(
            "[{}]",
            (b * 2000..(b + 1) * 2000)
                .map(|i| format!(
                    r#"{{"sql":{},"params":[{}],"method":"run"}}"#,
                    serde_json::to_string(&insert).unwrap(),
                    row_json(i)
                ))
                .collect::<Vec<_>>()
                .join(",")
        );
        let t = Instant::now();
        let statements: Vec<Statement> = serde_json::from_str(&json).unwrap();
        parse.push(t.elapsed());
        let t = Instant::now();
        db.batch(&statements).unwrap();
        write.push(t.elapsed());
    }
    println!(
        "2000-statement batch: parse {:?}, write {:?} (medians of 25)",
        median(parse),
        median(write)
    );

    let page = format!(
        "SELECT {COLS} FROM p WHERE hidden = 0 AND timestamp < ? ORDER BY timestamp DESC LIMIT 5000"
    );
    let (mut query, mut bytes) = (Vec::new(), 0);
    for r in 0..10 {
        let st = Statement {
            sql: page.clone(),
            params: serde_json::from_str(&format!(
                "[{}]",
                1_600_000_000_000i64 + (50_000 - r * 5000) as i64 * 60_000
            ))
            .unwrap(),
            method: Method::All,
        };
        let t = Instant::now();
        bytes = db.exec(&st).unwrap().len();
        query.push(t.elapsed());
    }
    println!(
        "5000-row page: query + JSON {:?} ({} KB) (medians of 10)",
        median(query),
        bytes / 1024
    );
    let mut count = Vec::new();
    for r in 0..10 {
        let st = Statement {
            sql: format!("SELECT COUNT(*), SUM(length(id) + length(image_hash)) FROM ({page})"),
            params: serde_json::from_str(&format!(
                "[{}]",
                1_600_000_000_000i64 + (50_000 - r * 5000) as i64 * 60_000
            ))
            .unwrap(),
            method: Method::Get,
        };
        let t = Instant::now();
        db.exec(&st).unwrap();
        count.push(t.elapsed());
    }
    println!("the same page counted in SQLite: {:?}", median(count));
    drop(db);
    let _ = std::fs::remove_dir_all(&dir);
}
