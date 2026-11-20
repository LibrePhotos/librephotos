use std::collections::BTreeSet;
use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender, channel};
use std::time::{Duration, Instant};

use serde::Serialize;

pub const WINDOW: Duration = Duration::from_millis(40);

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct Changed {
    pub tables: Vec<String>,
}

#[derive(Clone)]
pub struct ChangeHub {
    tx: Sender<BTreeSet<String>>,
}

impl ChangeHub {
    pub fn spawn(window: Duration, emit: impl Fn(Vec<String>) + Send + 'static) -> ChangeHub {
        let (tx, rx) = channel();
        let _ = std::thread::Builder::new()
            .name("lpview-db-changes".into())
            .spawn(move || run(rx, window, emit));
        ChangeHub { tx }
    }

    pub fn notify(&self, tables: BTreeSet<String>) {
        if !tables.is_empty() {
            let _ = self.tx.send(tables);
        }
    }
}

fn run(rx: Receiver<BTreeSet<String>>, window: Duration, emit: impl Fn(Vec<String>)) {
    while let Ok(mut tables) = rx.recv() {
        let end = Instant::now() + window;
        loop {
            let left = end.saturating_duration_since(Instant::now());
            if left.is_zero() {
                break;
            }
            match rx.recv_timeout(left) {
                Ok(more) => tables.extend(more),
                Err(RecvTimeoutError::Timeout) => break,
                Err(RecvTimeoutError::Disconnected) => {
                    emit(tables.into_iter().collect());
                    return;
                }
            }
        }
        emit(tables.into_iter().collect());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    fn set(names: &[&str]) -> BTreeSet<String> {
        names.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn coalesces_a_burst_into_one_event() {
        let (tx, rx) = mpsc::channel();
        let hub = ChangeHub::spawn(Duration::from_millis(40), move |t| tx.send(t).unwrap());
        let t0 = Instant::now();
        for i in 0..50 {
            hub.notify(set(if i % 2 == 0 {
                &["files"]
            } else {
                &["roots", "files"]
            }));
        }
        hub.notify(BTreeSet::new());
        let first = rx.recv_timeout(Duration::from_secs(2)).unwrap();
        assert_eq!(first, ["files", "roots"]);
        assert!(t0.elapsed() >= Duration::from_millis(40));
        assert!(
            rx.recv_timeout(Duration::from_millis(120)).is_err(),
            "one event"
        );
        hub.notify(set(&["outbox"]));
        assert_eq!(rx.recv_timeout(Duration::from_secs(2)).unwrap(), ["outbox"]);
    }

    #[test]
    fn a_long_stream_is_one_event_per_window() {
        let (tx, rx) = mpsc::channel();
        let hub = ChangeHub::spawn(Duration::from_millis(30), move |t| tx.send(t).unwrap());
        let t0 = Instant::now();
        while t0.elapsed() < Duration::from_millis(200) {
            hub.notify(set(&["files"]));
            std::thread::sleep(Duration::from_millis(2));
        }
        drop(hub);
        let events: Vec<_> = rx.iter().collect();
        assert!(
            (2..=10).contains(&events.len()),
            "{} events for ~200 ms at a 30 ms window",
            events.len()
        );
    }
}
