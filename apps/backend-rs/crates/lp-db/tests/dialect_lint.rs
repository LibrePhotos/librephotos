//! Dialect lint (design `sqlite_design.md` §2): counts the Postgres-only
//! constructs left in the SQL string literals of the SQL crates (lp-db,
//! lp-ingest, lp-tasks, lp-jobs). Literals inside a `Dialect::Pg => ..` match
//! arm, an `if ..is_pg() { .. }` block and the first argument of a
//! `push_dialect(..)` are Postgres-only by construction and are skipped.
//!
//! **Report-only** for now (P1a): it prints the counts per file and per
//! construct and passes. The SQLite phases flip [`ENFORCE`] once their areas
//! are ported (`cargo test -p lp-db --test dialect_lint -- --nocapture`).

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

/// `true` = fail on any hit (later phases); `false` = report only.
const ENFORCE: bool = false;

/// The lint list: (name, matcher). Matching is done on the literal's text.
fn constructs() -> Vec<(&'static str, fn(&str) -> usize)> {
    vec![
        // design §2 core list
        ("::uuid", |s| count_ci(s, "::uuid")),
        ("ANY(", |s| {
            count_word_paren(s, "ANY") + count_word_paren(s, "ALL")
        }),
        ("ILIKE", |s| count_word(s, "ILIKE")),
        ("jsonb", |s| count_ci(s, "jsonb")),
        ("LATERAL", |s| count_word(s, "LATERAL")),
        ("DISTINCT ON", |s| count_ci(s, "DISTINCT ON")),
        ("make_interval", |s| count_ci(s, "make_interval")),
        ("FOR UPDATE", |s| count_ci(s, "FOR UPDATE")),
        ("unnest", |s| count_word(s, "unnest")),
        // README "worth adding"
        ("::cast", other_casts),
        ("interval '", |s| count_ci(s, "interval '")),
        ("GREATEST/LEAST(", |s| {
            count_word_paren(s, "GREATEST") + count_word_paren(s, "LEAST")
        }),
        ("ON CONSTRAINT", |s| count_ci(s, "ON CONSTRAINT")),
        ("DELETE .. USING", delete_using),
        ("pg_", |s| count_ci(s, "pg_")),
        ("to_regclass", |s| count_ci(s, "to_regclass")),
        ("AT TIME ZONE", |s| count_ci(s, "AT TIME ZONE")),
        ("LIKE w/o ESCAPE", like_without_escape),
    ]
}

fn count_ci(s: &str, needle: &str) -> usize {
    s.to_ascii_lowercase()
        .matches(&needle.to_ascii_lowercase())
        .count()
}

fn is_ident(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_'
}

/// Whole-word, case-insensitive occurrences of `word`.
fn word_positions(s: &str, word: &str) -> Vec<usize> {
    let hay = s.to_ascii_lowercase();
    let w = word.to_ascii_lowercase();
    let b = hay.as_bytes();
    hay.match_indices(&w)
        .map(|(i, _)| i)
        .filter(|&i| {
            (i == 0 || !is_ident(b[i - 1])) && b.get(i + w.len()).is_none_or(|&c| !is_ident(c))
        })
        .collect()
}

fn count_word(s: &str, word: &str) -> usize {
    word_positions(s, word).len()
}

/// `WORD(` / `WORD (`.
fn count_word_paren(s: &str, word: &str) -> usize {
    word_positions(s, word)
        .into_iter()
        .filter(|&i| s[i + word.len()..].trim_start().starts_with('('))
        .count()
}

/// `x::type` casts other than `::uuid` (`::text`, `::date`, `::jsonb`, `::int[]` ..).
fn other_casts(s: &str) -> usize {
    let b = s.as_bytes();
    let mut n = 0;
    let mut i = 0;
    while i + 2 < b.len() {
        if b[i] == b':'
            && b[i + 1] == b':'
            && i > 0
            && (is_ident(b[i - 1]) || b[i - 1] == b')' || b[i - 1] == b'\'' || b[i - 1] == b']')
        {
            let rest = &s[i + 2..];
            let ty: String = rest
                .chars()
                .take_while(|c| c.is_ascii_alphanumeric() || *c == '_')
                .collect();
            if !ty.is_empty() && !ty.eq_ignore_ascii_case("uuid") {
                n += 1;
            }
            i += 2;
        } else {
            i += 1;
        }
    }
    n
}

fn delete_using(s: &str) -> usize {
    let words: Vec<usize> = word_positions(s, "DELETE");
    words
        .into_iter()
        .filter(|&i| {
            let tail = &s[i..];
            let end = tail
                .to_ascii_lowercase()
                .find(" where ")
                .unwrap_or(tail.len());
            count_word(&tail[..end], "USING") > 0
        })
        .count()
}

/// `LIKE` not followed by `ESCAPE` before the end of the predicate (roughly:
/// within the next 60 characters).
fn like_without_escape(s: &str) -> usize {
    word_positions(s, "LIKE")
        .into_iter()
        .filter(|&i| {
            let tail = &s[i..(i + 80).min(s.len())];
            let tail = &tail[..tail
                .char_indices()
                .last()
                .map_or(0, |(j, c)| j + c.len_utf8())];
            count_word(tail, "ESCAPE") == 0
        })
        .count()
}

// ------------------------------------------------------------ Rust scanning

/// A string literal: its text and the 1-based line it starts on.
struct Lit {
    line: usize,
    text: String,
    /// Inside a `Dialect::Pg` arm or the first argument of `push_dialect`.
    pg_only: bool,
}

/// String literals of a Rust file (normal, raw, byte strings), skipping
/// comments and char literals.
fn literals(src: &str) -> Vec<Lit> {
    let b = src.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    let mut line = 1;
    // `Dialect::Pg =>` arms: the brace depth at which the arm body ends, or
    // the line on which a single-expression arm ends.
    let mut depth: i64 = 0;
    let mut pg_block_depth: Option<i64> = None;
    // a single-expression arm ends at the next `,` (or the match's `}`) at
    // the arm's own (paren, brace) depth
    let mut pg_expr: Option<(i64, i64)> = None;
    let mut push_dialect_first_arg: Option<i64> = None; // paren depth
    let mut paren: i64 = 0;
    while i < b.len() {
        let c = b[i];
        if c == b'\n' {
            line += 1;
            i += 1;
            continue;
        }
        if src[i..].starts_with("//") {
            while i < b.len() && b[i] != b'\n' {
                i += 1;
            }
            continue;
        }
        if src[i..].starts_with("/*") {
            while i + 1 < b.len() && !(b[i] == b'*' && b[i + 1] == b'/') {
                if b[i] == b'\n' {
                    line += 1;
                }
                i += 1;
            }
            i += 2;
            continue;
        }
        if src[i..].starts_with("Dialect::Pg") {
            let rest = src[i + "Dialect::Pg".len()..].trim_start();
            if let Some(arm) = rest.strip_prefix("=>") {
                if arm.trim_start().starts_with('{') {
                    pg_block_depth = Some(depth + 1);
                } else {
                    pg_expr = Some((paren, depth));
                }
            }
            i += "Dialect::Pg".len();
            continue;
        }
        // `if <x>.dialect().is_pg() { .. }` / `if <x>.is_pg() { .. }`
        if src[i..].starts_with(".is_pg()") {
            if src[i + ".is_pg()".len()..].trim_start().starts_with('{') {
                pg_block_depth = Some(depth + 1);
            }
            i += ".is_pg()".len();
            continue;
        }
        if src[i..].starts_with("push_dialect(") {
            push_dialect_first_arg = Some(paren + 1);
            i += "push_dialect".len();
            continue;
        }
        match c {
            b'{' => depth += 1,
            b'}' => {
                if pg_block_depth == Some(depth) {
                    pg_block_depth = None;
                }
                if pg_expr.is_some_and(|(_, d)| d == depth) {
                    pg_expr = None;
                }
                depth -= 1;
            }
            b'(' => paren += 1,
            b')' => {
                if push_dialect_first_arg == Some(paren) {
                    push_dialect_first_arg = None;
                }
                paren -= 1;
            }
            b',' => {
                if push_dialect_first_arg == Some(paren) {
                    push_dialect_first_arg = None;
                }
                if pg_expr == Some((paren, depth)) {
                    pg_expr = None;
                }
            }
            _ => {}
        }
        let pg_only =
            pg_block_depth.is_some() || pg_expr.is_some() || push_dialect_first_arg.is_some();
        // raw strings r"..", r#".."#, br".."
        let raw_start = if c == b'r' && (b.get(i + 1) == Some(&b'"') || b.get(i + 1) == Some(&b'#'))
        {
            Some(i + 1)
        } else if c == b'b' && b.get(i + 1) == Some(&b'r') {
            Some(i + 2)
        } else {
            None
        };
        if let Some(mut j) = raw_start
            && (i == 0 || !is_ident(b[i - 1]))
        {
            let mut hashes = 0;
            while b.get(j) == Some(&b'#') {
                hashes += 1;
                j += 1;
            }
            if b.get(j) == Some(&b'"') {
                let start = j + 1;
                let close: String = format!("\"{}", "#".repeat(hashes));
                if let Some(end) = src[start..].find(&close) {
                    let text = &src[start..start + end];
                    out.push(Lit {
                        line,
                        text: text.to_string(),
                        pg_only,
                    });
                    line += text.matches('\n').count();
                    i = start + end + close.len();
                    continue;
                }
            }
        }
        if c == b'\'' {
            // char literal or lifetime: skip `'x'`, `'\n'`, `'\''`
            if b.get(i + 1) == Some(&b'\\') {
                if let Some(end) = src[i + 2..].find('\'') {
                    i += end + 3;
                    continue;
                }
            } else if b.get(i + 2) == Some(&b'\'') {
                i += 3;
                continue;
            }
            i += 1;
            continue;
        }
        if c == b'"' {
            let start = i + 1;
            let mut j = start;
            let mut text = String::new();
            while j < b.len() && b[j] != b'"' {
                if b[j] == b'\\' && j + 1 < b.len() {
                    if b[j + 1] == b'\n' {
                        // line continuation: skip the newline and indentation
                        line += 1;
                        j += 2;
                        while j < b.len() && (b[j] == b' ' || b[j] == b'\t') {
                            j += 1;
                        }
                        text.push(' ');
                        continue;
                    }
                    text.push(b[j + 1] as char);
                    j += 2;
                    continue;
                }
                if b[j] == b'\n' {
                    line += 1;
                }
                let ch = src[j..].chars().next().unwrap_or(' ');
                text.push(ch);
                j += ch.len_utf8();
            }
            out.push(Lit {
                line,
                text,
                pg_only,
            });
            i = j + 1;
            continue;
        }
        i += 1;
    }
    out
}

fn rust_files(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(rd) = std::fs::read_dir(dir) else {
        return;
    };
    for e in rd.flatten() {
        let p = e.path();
        if p.is_dir() {
            rust_files(&p, out);
        } else if p.extension().is_some_and(|x| x == "rs") {
            out.push(p);
        }
    }
}

#[test]
fn dialect_lint() {
    let crates = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
    let roots = ["lp-db/src", "lp-ingest/src", "lp-tasks/src", "lp-jobs/src"];
    let cs = constructs();
    // file -> construct -> count
    let mut per_file: BTreeMap<String, BTreeMap<&str, usize>> = BTreeMap::new();
    let mut totals: BTreeMap<&str, usize> = BTreeMap::new();
    let mut skipped_pg = 0usize;
    for root in roots {
        let mut files = Vec::new();
        rust_files(&crates.join(root), &mut files);
        files.sort();
        for f in files {
            let rel = f
                .strip_prefix(&crates)
                .unwrap_or(&f)
                .to_string_lossy()
                .replace('\\', "/");
            let src = std::fs::read_to_string(&f).expect("read source");
            for lit in literals(&src) {
                if lit.pg_only {
                    skipped_pg += 1;
                    continue;
                }
                for (name, m) in &cs {
                    let n = m(&lit.text);
                    if n > 0 {
                        *per_file
                            .entry(rel.clone())
                            .or_default()
                            .entry(name)
                            .or_default() += n;
                        *totals.entry(name).or_default() += n;
                    }
                }
                let _ = lit.line;
            }
        }
    }

    let mut report = String::new();
    report.push_str("dialect lint (Postgres-only constructs in SQL literals)\n");
    for (file, m) in &per_file {
        let total: usize = m.values().sum();
        let detail: Vec<String> = m.iter().map(|(k, v)| format!("{k}={v}")).collect();
        report.push_str(&format!("{total:5}  {file}  [{}]\n", detail.join(", ")));
    }
    report.push_str("totals:\n");
    for (k, v) in &totals {
        report.push_str(&format!("{v:5}  {k}\n"));
    }
    report.push_str(&format!(
        "{:5}  files with hits; {skipped_pg} literals skipped as Dialect::Pg-only\n",
        per_file.len()
    ));
    println!("{report}");

    if ENFORCE {
        assert!(
            per_file.is_empty(),
            "Postgres-only SQL outside Dialect::Pg arms:\n{report}"
        );
    }
}

#[test]
fn lint_matchers() {
    let cs: BTreeMap<_, _> = constructs().into_iter().collect();
    assert_eq!(cs["ANY("]("WHERE id = ANY($1) AND x <> ALL ($2)"), 2);
    assert_eq!(cs["ANY("]("company"), 0);
    assert_eq!(cs["::uuid"]("$1::uuid[]"), 1);
    assert_eq!(cs["::cast"]("$1::uuid, $2::text[], x::date, 'a::b'"), 3);
    assert_eq!(
        cs["LIKE w/o ESCAPE"]("a LIKE $1 ESCAPE '\\' OR b LIKE $2"),
        1
    );
    assert_eq!(
        cs["DELETE .. USING"]("DELETE FROM a USING b WHERE a.id = b.id"),
        1
    );
    assert_eq!(
        cs["DELETE .. USING"]("DELETE FROM a WHERE id IN (SELECT 1 FROM b USING (x))"),
        0
    );
    let lits = literals(
        "let s = match d { Dialect::Pg => \"unnest($1)\", Dialect::Sqlite => \"json_each($1)\" };\n\
         let t = \"x = ANY($1)\";\n\
         qb.push_dialect(\"a::uuid\", \"a\");\n\
         if tx.dialect().is_pg() { q(\"SELECT pg_x()\"); }\n",
    );
    let flagged: Vec<(&str, bool)> = lits.iter().map(|l| (l.text.as_str(), l.pg_only)).collect();
    assert_eq!(
        flagged,
        vec![
            ("unnest($1)", true),
            ("json_each($1)", false),
            ("x = ANY($1)", false),
            ("a::uuid", true),
            ("a", false),
            ("SELECT pg_x()", true),
        ]
    );
}
