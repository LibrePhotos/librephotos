//! The in-process / sidecar switch (`LP_ML_<SERVICE>`), status reporting
//! and the error mapping.

use std::sync::Arc;

use lp_ml::{Ml, MlConfig, Mode, Selection, Service};
use lp_sidecars::{Sidecar, SidecarError, Sidecars};

fn ml(media_root: &std::path::Path) -> Ml {
    Ml::new(
        MlConfig::new(media_root.to_path_buf()),
        Arc::new(|| Selection {
            tagging_model: "mobileclip_s2".into(),
            face_recognition_model: "buffalo_sc".into(),
            ocr_model: "ppocrv6_small".into(),
            captioning_model: "lfm2_vl_450m".into(),
        }),
    )
}

#[test]
fn modes_parse() {
    assert_eq!(Mode::parse("inprocess"), Some(Mode::InProcess));
    assert_eq!(Mode::parse("Sidecar"), Some(Mode::Sidecar));
    assert_eq!(Mode::parse(""), Some(Mode::Auto));
    assert_eq!(Mode::parse("gpu"), None);
    for s in Service::ALL {
        assert_eq!(Service::from_name(s.name()), Some(s));
    }
    assert_eq!(Service::RawThumbnail.name(), "thumbnail");
    assert_eq!(Service::FaceCluster.env_key(), "FACE_CLUSTER");
}

#[test]
fn explicit_modes_win_and_auto_is_in_process() {
    let dir = tempfile::tempdir().unwrap();
    let ml = ml(dir.path());
    let sidecars = Sidecars::new(reqwest::Client::new(), "127.0.0.1");
    let view = ml.view(&sidecars);

    // Every service is ported, and auto serves it in-process even before its
    // model is downloaded (the call is `unavailable`, never a sidecar).
    for s in Service::ALL {
        assert!(view.is_inprocess(s), "{s:?} defaults to in-process");
        let st = view.status(s);
        assert_eq!((st.mode, st.configured), ("inprocess", Mode::Auto));
    }
    for s in [
        Service::Clip,
        Service::Tags,
        Service::Ocr,
        Service::Face,
        Service::Caption,
    ] {
        assert!(!view.status(s).ready, "{s:?} without its model");
    }
    for s in [
        Service::Similarity,
        Service::FaceCluster,
        Service::RawThumbnail,
    ] {
        assert!(view.status(s).ready, "{s:?} needs no model");
    }

    ml.set_mode(Service::Clip, Mode::InProcess);
    assert!(ml.view(&sidecars).is_inprocess(Service::Clip));
    let st = ml.view(&sidecars).status(Service::Clip);
    assert_eq!((st.mode, st.configured), ("inprocess", Mode::InProcess));
    assert!(!st.model_loaded && !st.busy && st.last_used.is_none());

    ml.set_mode(Service::Similarity, Mode::Sidecar);
    assert!(!ml.view(&sidecars).is_inprocess(Service::Similarity));

    // A redirected sidecar (LP_SIDECAR_*_URL, a test mock) keeps auto on HTTP.
    ml.set_mode(Service::FaceCluster, Mode::Auto);
    let mocked = sidecars
        .clone()
        .with_base(Sidecar::FaceCluster, "http://127.0.0.1:9");
    assert!(mocked.is_redirected(Sidecar::FaceCluster));
    assert!(!ml.view(&mocked).is_inprocess(Service::FaceCluster));
    assert!(!ml.unload(Service::Clip), "nothing loaded");
    assert!(ml.loaded_models(Service::Clip).is_empty());
}

#[test]
fn in_process_errors_look_like_sidecar_answers() {
    match lp_ml::bad_input(Service::Ocr, "Image not found") {
        SidecarError::Status {
            status,
            detail,
            url,
            ..
        } => {
            assert_eq!((status, detail.as_str()), (400, "Image not found"));
            assert_eq!(url, "inprocess:ocr");
        }
        other => panic!("{other:?}"),
    }
    let e = lp_ml::failed(Service::Tags, "Failed to process image");
    assert_eq!(e.status(), Some(500));
    assert_eq!(e.detail(), "Failed to process image");
    let e = lp_ml::not_implemented(Service::Caption);
    assert!(matches!(e, SidecarError::Unreachable { .. }));
    assert!(e.detail().contains("LP_ML_CAPTION=sidecar"));
}
