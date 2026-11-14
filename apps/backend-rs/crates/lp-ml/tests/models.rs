//! The model store: selection, installed checks, zip flattening, and the
//! verified `.part` download against a local HTTP server.

use std::io::Write;
use std::path::Path;

use lp_ml::models::{self, MlType, Selection};
use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

fn sel(tagging: &str, face: &str, ocr: &str) -> Selection {
    Selection {
        tagging_model: tagging.into(),
        face_recognition_model: face.into(),
        ocr_model: ocr.into(),
        captioning_model: "lfm2_vl_450m".into(),
        semantic_search_model: String::new(),
    }
}

#[test]
fn selection_follows_the_site_settings() {
    let s = sel("mobileclip_s2", "buffalo_sc", "none");
    let names: Vec<&str> = models::required(&s).map(|m| m.name).collect();
    // MobileCLIP-S2 serves tags and semantic search: no CLIP ViT-B/32.
    assert_eq!(names, ["mobileclip_s2", "buffalo_sc", "lfm2_vl_450m"]);
    let mut s = sel("mobileclip_s2", "buffalo_sc", "none");
    s.semantic_search_model = "clip_vit_b32".into();
    let names: Vec<&str> = models::required(&s).map(|m| m.name).collect();
    assert_eq!(
        names,
        [
            "clip_vit_b32",
            "mobileclip_s2",
            "buffalo_sc",
            "lfm2_vl_450m"
        ]
    );
    let mut s = sel("siglip2", "antelopev2", "ppocrv6_medium");
    let names: Vec<&str> = models::required(&s).map(|m| m.name).collect();
    // Semantic search keeps MobileCLIP-S2 next to the SigLIP 2 tagger.
    assert!(names.contains(&"siglip2") && names.contains(&"mobileclip_s2"));
    s.semantic_search_model = "clip_vit_b32".into();
    let names: Vec<&str> = models::required(&s).map(|m| m.name).collect();
    assert!(names.contains(&"siglip2") && names.contains(&"ppocrv6_medium"));
    assert!(!names.contains(&"mobileclip_s2") && !names.contains(&"buffalo_sc"));
    assert!(models::not_selected(" None "));
    assert!(models::not_selected(""));
    assert_eq!(models::CATALOG.len(), 12);
    assert!(models::CATALOG.iter().all(|m| m.sha256.len() == 64));
    let caption = models::by_name("lfm2_vl_450m").unwrap();
    assert_eq!(caption.ml_type, MlType::Captioning);
    assert_eq!(caption.additional_files.len(), 6);
}

fn touch(p: &Path) {
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, b"x").unwrap();
}

#[test]
fn installed_checks_and_wrapper_flattening() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    let face = models::by_name("buffalo_m").unwrap();
    std::fs::create_dir_all(root.join(face.target_dir)).unwrap();
    assert!(!models::target_exists(root, face), "no .onnx yet");
    // antelopev2/buffalo_m zips wrap their files in a folder.
    touch(
        &root
            .join(face.target_dir)
            .join("buffalo_m")
            .join("det_2.5g.onnx"),
    );
    assert!(!models::target_exists(root, face));
    models::flatten_wrapper_dir(&root.join(face.target_dir)).unwrap();
    assert!(models::target_exists(root, face));
    assert!(root.join(face.target_dir).join("det_2.5g.onnx").exists());

    let ocr = models::by_name("ppocrv6_tiny").unwrap();
    touch(&root.join(ocr.target_dir).join("det.onnx"));
    assert!(!models::target_exists(root, ocr), "half-extracted bundle");
    for f in ["rec.onnx", "charset.txt", "config.json"] {
        touch(&root.join(ocr.target_dir).join(f));
    }
    assert!(models::target_exists(root, ocr));

    let clip = models::by_name("clip_vit_b32").unwrap();
    touch(&root.join(clip.target_dir));
    assert!(!models::target_exists(root, clip), "extra files missing");
    for f in clip.additional_files {
        touch(&root.join(f.target));
    }
    assert!(models::target_exists(root, clip));
    assert_eq!(models::model_dir(root, clip), root.join("clip_vit_b32"));
    assert_eq!(models::size_on_disk(root, clip), 3);
    assert!(!models::captioning_model_exists(root));
}

/// A one-shot HTTP/1.1 server answering every request with `body` (and a
/// `Content-Length` of `claimed` bytes).
async fn serve(body: Vec<u8>, claimed: usize) -> String {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        while let Ok((mut sock, _)) = listener.accept().await {
            let body = body.clone();
            tokio::spawn(async move {
                let mut buf = [0u8; 4096];
                let _ = sock.read(&mut buf).await;
                let head = format!(
                    "HTTP/1.1 200 OK\r\nContent-Length: {claimed}\r\nConnection: close\r\n\r\n"
                );
                let _ = sock.write_all(head.as_bytes()).await;
                let _ = sock.write_all(&body).await;
                let _ = sock.shutdown().await;
            });
        }
    });
    format!("http://{addr}/file")
}

#[tokio::test]
async fn downloads_are_verified_before_they_land() {
    let dir = tempfile::tempdir().unwrap();
    let http = models::http_client().unwrap();
    let body = b"model bytes".to_vec();
    let sha = hex::encode(Sha256::digest(&body));
    let url = serve(body.clone(), body.len()).await;

    let target = dir.path().join("m").join("model.onnx");
    models::download_file(&http, &url, &target, "m", Some(&sha))
        .await
        .unwrap();
    assert_eq!(std::fs::read(&target).unwrap(), body);
    assert!(!dir.path().join("m").join("model.onnx.part").exists());

    let bad = dir.path().join("bad.onnx");
    let err = models::download_file(&http, &url, &bad, "bad", Some(&"0".repeat(64)))
        .await
        .unwrap_err();
    assert!(err.to_string().contains("Checksum mismatch"), "{err}");
    assert!(!bad.exists());
    assert!(!dir.path().join("bad.onnx.part").exists());

    // The server promises more bytes than it sends.
    let short = serve(body.clone(), body.len() + 10).await;
    let cut = dir.path().join("cut.onnx");
    assert!(
        models::download_file(&http, &short, &cut, "cut", None)
            .await
            .is_err()
    );
    assert!(!cut.exists());
    assert!(!dir.path().join("cut.onnx.part").exists());
}

#[test]
fn archives_are_unpacked_like_ml_models_py() {
    let dir = tempfile::tempdir().unwrap();
    let zip_path = dir.path().join("pack.zip");
    {
        let f = std::fs::File::create(&zip_path).unwrap();
        let mut z = zip::ZipWriter::new(f);
        let opts = zip::write::SimpleFileOptions::default();
        z.start_file("antelopev2/scrfd.onnx", opts).unwrap();
        z.write_all(b"det").unwrap();
        z.start_file("antelopev2/glintr100.onnx", opts).unwrap();
        z.write_all(b"rec").unwrap();
        z.finish().unwrap();
    }
    let spec = models::by_name("antelopev2").unwrap();
    models::unpack_archive(&zip_path, dir.path(), spec).unwrap();
    let target = dir.path().join(spec.target_dir);
    assert!(target.join("scrfd.onnx").exists());
    assert!(target.join("glintr100.onnx").exists());
    assert!(models::target_exists(dir.path(), spec));

    // A tar.gz bundle lands under data_models/ocr/<name>/.
    let tgz = dir.path().join("ocr.tar.gz");
    {
        let f = std::fs::File::create(&tgz).unwrap();
        let gz = flate2::write::GzEncoder::new(f, flate2::Compression::fast());
        let mut tar = tar::Builder::new(gz);
        for name in ["det.onnx", "rec.onnx", "charset.txt", "config.json"] {
            let mut h = tar::Header::new_gnu();
            h.set_size(1);
            h.set_mode(0o644);
            h.set_cksum();
            tar.append_data(&mut h, format!("ocr/ppocrv6_tiny/{name}"), &b"x"[..])
                .unwrap();
        }
        tar.into_inner().unwrap().finish().unwrap();
    }
    let ocr = models::by_name("ppocrv6_tiny").unwrap();
    models::unpack_archive(&tgz, dir.path(), ocr).unwrap();
    assert!(models::target_exists(dir.path(), ocr));
}
