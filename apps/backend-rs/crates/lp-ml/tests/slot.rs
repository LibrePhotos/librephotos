//! ModelSlot: lazy load, reuse, reload on a new key, the concurrency
//! limit, idle unload, and no unload while a call runs.

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use lp_ml::Service;
use lp_ml::slot::{ModelSlot, Registry};

struct Model {
    key: String,
}

fn loader(
    loads: &Arc<AtomicUsize>,
    key: &str,
) -> impl FnOnce() -> anyhow::Result<Model> + Send + 'static {
    let loads = loads.clone();
    let key = key.to_string();
    move || {
        loads.fetch_add(1, Ordering::SeqCst);
        Ok(Model { key })
    }
}

#[tokio::test]
async fn loads_lazily_reuses_and_reloads_on_a_new_key() {
    let reg = Registry::default();
    let slot: ModelSlot<Model> = ModelSlot::new(&reg, Service::Clip, "clip", 1);
    let loads = Arc::new(AtomicUsize::new(0));
    assert_eq!(slot.info().loaded(), 0);
    assert!(slot.info().last_used().is_none());

    for _ in 0..3 {
        let k = slot
            .run("a", loader(&loads, "a"), |m| Ok(m.key.clone()))
            .await
            .unwrap();
        assert_eq!(k, "a");
    }
    assert_eq!(loads.load(Ordering::SeqCst), 1, "loaded once, then reused");
    assert_eq!(slot.info().loaded(), 1);
    assert!(slot.info().last_used().is_some());

    let k = slot
        .run("b", loader(&loads, "b"), |m| Ok(m.key.clone()))
        .await
        .unwrap();
    assert_eq!(k, "b");
    assert_eq!(loads.load(Ordering::SeqCst), 2);
    assert_eq!(slot.info().loaded(), 1, "the old model was dropped");

    // A failed call keeps the instance; a failed load leaves nothing behind.
    let err = slot
        .run("b", loader(&loads, "b"), |_| -> anyhow::Result<()> {
            anyhow::bail!("bad input")
        })
        .await
        .unwrap_err();
    assert!(err.to_string().contains("bad input"));
    assert_eq!(slot.info().loaded(), 1);
    let err = slot
        .run(
            "c",
            || -> anyhow::Result<Model> { anyhow::bail!("no such model") },
            |_| Ok(()),
        )
        .await
        .unwrap_err();
    assert!(err.to_string().contains("no such model"));
    assert_eq!(slot.info().loaded(), 0);

    // A panic inside inference is an error, and the instance is dropped.
    slot.run("d", loader(&loads, "d"), |_| Ok(()))
        .await
        .unwrap();
    let err = slot
        .run("d", loader(&loads, "d"), |_| -> anyhow::Result<()> {
            panic!("boom")
        })
        .await
        .unwrap_err();
    assert!(err.to_string().contains("boom"), "{err}");
    assert_eq!(slot.info().loaded(), 0);
}

#[tokio::test]
async fn concurrency_limit_bounds_parallel_calls_and_copies() {
    let reg = Registry::default();
    let slot: ModelSlot<Model> = ModelSlot::new(&reg, Service::Face, "face", 2);
    let loads = Arc::new(AtomicUsize::new(0));
    let running = Arc::new(AtomicUsize::new(0));
    let peak = Arc::new(AtomicUsize::new(0));
    let mut tasks = Vec::new();
    for _ in 0..6 {
        let slot = slot.clone();
        let (loads, running, peak) = (loads.clone(), running.clone(), peak.clone());
        tasks.push(tokio::spawn(async move {
            slot.run("m", loader(&loads, "m"), move |_| {
                let now = running.fetch_add(1, Ordering::SeqCst) + 1;
                peak.fetch_max(now, Ordering::SeqCst);
                std::thread::sleep(Duration::from_millis(50));
                running.fetch_sub(1, Ordering::SeqCst);
                Ok(())
            })
            .await
        }));
    }
    for t in tasks {
        t.await.unwrap().unwrap();
    }
    assert_eq!(peak.load(Ordering::SeqCst), 2);
    assert_eq!(loads.load(Ordering::SeqCst), 2, "two copies, then reused");
    assert_eq!(slot.info().loaded(), 2);
}

#[tokio::test]
async fn idle_models_are_unloaded_but_not_while_busy() {
    let reg = Arc::new(Registry::default());
    let slot: ModelSlot<Model> = ModelSlot::new(&reg, Service::Tags, "tags", 1);
    let loads = Arc::new(AtomicUsize::new(0));
    slot.run("m", loader(&loads, "m"), |_| Ok(()))
        .await
        .unwrap();

    // Not idle long enough.
    assert_eq!(reg.unload_idle(Duration::from_secs(3600)), 0);
    assert_eq!(slot.info().loaded(), 1);

    // Busy: a call is running, nothing is unloaded.
    let (tx, rx) = std::sync::mpsc::channel::<()>();
    let busy = {
        let slot = slot.clone();
        let loads = loads.clone();
        tokio::spawn(async move {
            slot.run("m", loader(&loads, "m"), move |_| {
                rx.recv().ok();
                Ok(())
            })
            .await
        })
    };
    while slot.info().in_flight() == 0 {
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    assert_eq!(reg.unload_idle(Duration::ZERO), 0);
    assert!(!reg.unload_service(Service::Tags));
    tx.send(()).unwrap();
    busy.await.unwrap().unwrap();

    assert_eq!(reg.unload_idle(Duration::ZERO), 1);
    assert_eq!(slot.info().loaded(), 0);
    assert_eq!(reg.of(Service::Tags).len(), 1);
    assert!(reg.of(Service::Clip).is_empty());

    // The reaper thread does the same on its own.
    slot.run("m", loader(&loads, "m"), |_| Ok(()))
        .await
        .unwrap();
    lp_ml::slot::spawn_reaper(
        Arc::downgrade(&reg),
        Duration::from_millis(50),
        Duration::from_millis(20),
    );
    for _ in 0..100 {
        if slot.info().loaded() == 0 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert_eq!(slot.info().loaded(), 0, "reaper unloaded the idle model");
}
