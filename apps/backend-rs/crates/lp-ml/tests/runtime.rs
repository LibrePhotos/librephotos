//! ONNX Runtime end to end: load the runtime (`LP_ORT_LIB` /
//! `ORT_DYLIB_PATH`), run a real model through a ModelSlot, unload it.
//! Skipped when no runtime library or no buffalo_sc detector is available.

use std::path::PathBuf;
use std::time::Duration;

use lp_ml::Service;
use lp_ml::slot::{ModelSlot, Registry};
use ort::session::Session;
use ort::value::Tensor;

#[test]
fn providers_parse() {
    assert_eq!(
        lp_ml::runtime::parse_providers(" CUDAExecutionProvider, ,CPUExecutionProvider"),
        vec!["CUDAExecutionProvider", "CPUExecutionProvider"]
    );
    assert!(lp_ml::runtime::parse_providers("").is_empty());
    assert_eq!(
        lp_ml::runtime::parse_providers("dml, CUDA,cpu,DirectML"),
        vec![
            lp_ml::runtime::DML,
            lp_ml::runtime::CUDA,
            lp_ml::runtime::CPU,
            lp_ml::runtime::DML
        ]
    );
}

#[test]
fn arena_modes_parse() {
    use lp_ml::runtime::ArenaMode;
    assert_eq!(ArenaMode::parse("1"), Some(ArenaMode::On));
    assert_eq!(ArenaMode::parse(" OFF "), Some(ArenaMode::Off));
    assert_eq!(ArenaMode::parse("0"), Some(ArenaMode::Off));
    assert_eq!(ArenaMode::parse("shrink"), Some(ArenaMode::Shrink));
    assert_eq!(ArenaMode::parse("Shared"), Some(ArenaMode::Shared));
    assert_eq!(ArenaMode::parse("bogus"), None);
    assert_eq!(lp_ml::runtime::DEFAULT_ARENA, ArenaMode::Shared);
}

fn detector() -> Option<PathBuf> {
    let lib = std::env::var_os("LP_ORT_LIB").or_else(|| std::env::var_os("ORT_DYLIB_PATH"));
    if lib.is_none() {
        eprintln!("no LP_ORT_LIB; skipping");
        return None;
    }
    let p = lp_ml::golden::data_models().join("face_recognition/models/buffalo_sc/det_500m.onnx");
    if !p.exists() {
        eprintln!("{} missing; skipping", p.display());
        return None;
    }
    Some(p)
}

#[tokio::test]
async fn a_model_runs_in_a_slot_and_unloads() {
    let Some(model) = detector() else {
        return;
    };
    let info = lp_ml::runtime::init().expect("ONNX Runtime loads");
    assert!(info.providers.iter().any(|p| p == lp_ml::runtime::CPU));

    let reg = Registry::default();
    let slot: ModelSlot<Session> = ModelSlot::new(&reg, Service::Face, "det_500m", 1);
    let path = model.clone();
    let outputs = slot
        .run(
            &model.display().to_string(),
            move || lp_ml::runtime::session(&path),
            |s| {
                let input = Tensor::from_array(([1usize, 3, 640, 640], vec![0f32; 3 * 640 * 640]))?;
                let out = lp_ml::runtime::run(s, ort::inputs![input])?;
                let mut shapes = Vec::new();
                for (_, v) in out.iter() {
                    let (shape, _) = v.try_extract_tensor::<f32>()?;
                    shapes.push(shape.to_vec());
                }
                Ok(shapes)
            },
        )
        .await
        .expect("inference");
    // SCRFD: scores, boxes and keypoints at strides 8, 16, 32.
    assert_eq!(outputs.len(), 9, "{outputs:?}");
    assert_eq!(slot.info().loaded(), 1);
    assert_eq!(reg.unload_idle(Duration::ZERO), 1);
    assert_eq!(slot.info().loaded(), 0);
}
