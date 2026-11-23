use std::io::Write;
use std::sync::Arc;

use lp_server::logfile::{DjangoFormat, RotatingFile};
use tracing_subscriber::layer::SubscriberExt;

#[test]
fn rotates_like_python_rotating_file_handler() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("logs").join("ownphotos.log");
    let log = RotatingFile::open(&path, 10, 2).unwrap();
    let mut w = &log;
    for line in ["aaaaaaaa\n", "bbbbbbbb\n", "cccccccc\n", "dddddddd\n"] {
        w.write_all(line.as_bytes()).unwrap();
    }
    drop(log);
    let read = |p: &std::path::Path| std::fs::read_to_string(p).unwrap();
    assert_eq!(read(&path), "dddddddd\n");
    assert_eq!(read(&dir.path().join("logs/ownphotos.log.1")), "cccccccc\n");
    assert_eq!(read(&dir.path().join("logs/ownphotos.log.2")), "bbbbbbbb\n");
    assert!(!dir.path().join("logs/ownphotos.log.3").exists());
}

#[test]
fn appends_to_an_existing_file() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("ownphotos.log");
    std::fs::write(&path, "old line\n").unwrap();
    let log = RotatingFile::open(&path, 1024, 1).unwrap();
    (&log).write_all(b"new line\n").unwrap();
    drop(log);
    assert_eq!(
        std::fs::read_to_string(&path).unwrap(),
        "old line\nnew line\n"
    );
}

#[test]
fn lines_have_the_django_layout() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("ownphotos.log");
    let log = Arc::new(RotatingFile::open(&path, 0, 0).unwrap());
    let subscriber = tracing_subscriber::registry().with(
        tracing_subscriber::fmt::layer()
            .with_ansi(false)
            .event_format(DjangoFormat)
            .with_writer(log.clone()),
    );
    tracing::subscriber::with_default(subscriber, || {
        tracing::warn!(photo = 7, "thumbnail failed");
    });
    let text = std::fs::read_to_string(&path).unwrap();
    let parts: Vec<&str> = text.trim_end().split(" : ").collect();
    assert_eq!(parts.len(), 6, "{text}");
    let re = regex::Regex::new(r"^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d,\d{3}$").unwrap();
    assert!(re.is_match(parts[0]), "{text}");
    assert_eq!(parts[1], "logfile.rs");
    assert_eq!(parts[2], "logfile");
    assert!(parts[3].parse::<u32>().unwrap() > 0);
    assert_eq!(parts[4], "WARNING");
    assert_eq!(parts[5], "thumbnail failed photo=7");
}
