//! Supervisor start/stop/health against a stand-in sidecar script (no
//! real sidecar, no port bound).

use std::collections::HashMap;
use std::path::PathBuf;

use lp_sidecars::supervisor::{Supervisor, SupervisorConfig, model_selected};

fn python() -> Option<PathBuf> {
    let p = std::env::var_os("LP_TEST_PYTHON")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(
                r"C:\Users\Niaz\librephotos\wt-windev\apps\backend\.venv-win\Scripts\python.exe",
            )
        });
    p.exists().then_some(p)
}

fn config(backend: &std::path::Path, python: PathBuf) -> SupervisorConfig {
    SupervisorConfig {
        python,
        backend_dir: backend.to_path_buf(),
        host: "127.0.0.1".into(),
        env: vec![("BASE_DATA".into(), backend.display().to_string())],
        flags: HashMap::from([("FEATURE_FACE_DETECTION", false)]),
        ocr_model_selected: false,
    }
}

#[test]
fn enablement_follows_flags_and_the_ocr_setting() {
    let dir = tempfile::tempdir().unwrap();
    let mut cfg = config(dir.path(), PathBuf::from("python"));
    assert!(cfg.is_enabled("thumbnail"));
    assert!(!cfg.is_enabled("face_recognition"));
    assert_eq!(
        cfg.disabled_reason("face_recognition"),
        "FEATURE_FACE_DETECTION is disabled"
    );
    assert!(!cfg.is_enabled("ocr"));
    assert_eq!(
        cfg.disabled_reason("ocr"),
        "no model is selected for it in the site settings"
    );
    cfg.ocr_model_selected = true;
    assert!(cfg.is_enabled("ocr"));
    assert!(!cfg.is_enabled("exif"));
    // face_cluster is listed only once its script exists.
    assert!(cfg.spec("face_cluster").is_none());
    std::fs::create_dir_all(dir.path().join("service/face_cluster")).unwrap();
    std::fs::write(dir.path().join("service/face_cluster/main.py"), "").unwrap();
    assert!(cfg.spec("face_cluster").is_some());
    assert!(!model_selected("None") && !model_selected(" ") && model_selected("paddle"));
}

#[tokio::test]
async fn starts_tracks_and_stops_only_its_own_children() {
    let Some(py) = python() else {
        eprintln!("no python; skipped");
        return;
    };
    let dir = tempfile::tempdir().unwrap();
    let script = dir.path().join("service/thumbnail/main.py");
    std::fs::create_dir_all(script.parent().unwrap()).unwrap();
    std::fs::write(&script, "import time\ntime.sleep(120)\n").unwrap();
    let cfg = config(dir.path(), py);
    let sup = Supervisor::new();

    assert!(!sup.is_running("thumbnail"));
    assert!(!sup.stop("thumbnail").await, "nothing to stop yet");
    assert!(!sup.start(&cfg, "face_recognition"), "disabled by flag");
    assert!(sup.start(&cfg, "thumbnail"));
    let pid = sup.pid("thumbnail").unwrap();
    assert!(sup.is_running("thumbnail"));
    // Already running: not started twice.
    assert!(sup.start(&cfg, "thumbnail"));
    assert_eq!(sup.pid("thumbnail"), Some(pid));
    // Alive but not answering /health counts as busy, not dead.
    let http = reqwest::Client::new();
    assert!(sup.is_healthy(&http, &cfg, "thumbnail").await);
    assert!(sup.stop("thumbnail").await);
    assert!(!sup.is_running("thumbnail"));
    assert!(!sup.stop("thumbnail").await);

    // A child that exits on its own is reaped.
    std::fs::write(&script, "import sys\nsys.exit(0)\n").unwrap();
    assert!(sup.start(&cfg, "thumbnail"));
    for _ in 0..100 {
        if !sup.is_running("thumbnail") {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    assert!(!sup.is_running("thumbnail"));
    // A missing interpreter is a failed start.
    let mut bad = cfg.clone();
    bad.python = dir.path().join("no-such-python.exe");
    assert!(!sup.start(&bad, "clip_embeddings"));
}
