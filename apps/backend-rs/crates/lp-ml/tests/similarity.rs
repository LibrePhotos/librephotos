//! In-process similarity index against FAISS (`tests/ml/golden_similarity.py`),
//! plus the paged-rebuild contract and persistence.

use std::sync::Arc;

use lp_ml::golden::{self, Array};
use lp_ml::{Ml, MlConfig, Mode, Service};
use lp_sidecars::{SidecarError, Sidecars, SimilarityBuild};

fn ml(media_root: &std::path::Path) -> Ml {
    let ml = Ml::new(
        MlConfig::new(media_root.to_path_buf()),
        Arc::new(lp_ml::Selection::default),
    );
    ml.set_mode(Service::Similarity, Mode::InProcess);
    ml
}

fn sidecars() -> Sidecars {
    Sidecars::new(reqwest::Client::new(), "127.0.0.1")
}

async fn rebuild(ml: &Ml, user_id: i32, hashes: &[String], embs: &[Vec<f32>], page: usize) -> i64 {
    let sc = sidecars();
    let view = ml.view(&sc);
    let pages = hashes.len().div_ceil(page).max(1);
    let mut size = 0;
    for p in 0..pages {
        let lo = (p * page).min(hashes.len());
        let hi = ((p + 1) * page).min(hashes.len());
        let r = view
            .similarity()
            .build(&SimilarityBuild {
                user_id,
                image_hashes: &hashes[lo..hi],
                image_embeddings: &embs[lo..hi],
                begin: p == 0,
                commit: p + 1 == pages,
            })
            .await
            .unwrap();
        assert_eq!(r.status, serde_json::Value::Bool(true));
        size = r.index_size.unwrap();
    }
    size
}

#[tokio::test]
async fn search_matches_faiss() {
    let Some(g) = golden::load("similarity", "search") else {
        return;
    };
    let dir = tempfile::tempdir().unwrap();
    let ml = ml(dir.path());
    let user = g.meta["user_id"].as_i64().unwrap() as i32;
    let hashes: Vec<String> = g.meta["hashes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|h| h.as_str().unwrap().to_string())
        .collect();
    let flat = Array::from_json(&g.meta["embeddings"]).f32();
    let embs: Vec<Vec<f32>> = flat.chunks(512).map(<[f32]>::to_vec).collect();
    let size = rebuild(&ml, user, &hashes, &embs, 250).await;
    assert_eq!(size as usize, hashes.len());

    // The inner products themselves are FAISS's, bit for bit.
    let (mut checked, mut off) = (0usize, 0usize);
    for c in g.cases.iter().filter(|c| !c.output["faiss_ids"].is_null()) {
        let q = Array::from_json(&c.input["embedding"]).f32();
        let ids = Array::from_json(&c.output["faiss_ids"]).i64();
        let dist = Array::from_json(&c.output["faiss_dist"]).f32();
        for (i, d) in ids.iter().zip(&dist) {
            let ours = lp_ml::similarity::index::dot(&embs[*i as usize], &q);
            checked += 1;
            if ours.to_bits() != d.to_bits() {
                off += 1;
            }
        }
    }
    eprintln!("{checked} inner products, {off} not bit-identical to FAISS");
    assert_eq!(off, 0);

    // A fresh process reads the index back from disk.
    let ml = self::ml(dir.path());
    let sc = sidecars();
    let view = ml.view(&sc);
    let (mut hits, mut mismatches) = (0usize, Vec::new());
    for c in &g.cases {
        let q = Array::from_json(&c.input["embedding"]).f32();
        let n = c.input["n"].as_u64().map(|n| n as usize);
        let thr = c.input["threshold"].as_f64().unwrap();
        let got: Vec<String> = view
            .similarity()
            .search(user, &q, n, thr)
            .await
            .unwrap()
            .result
            .iter()
            .map(|v| v.as_str().unwrap().to_string())
            .collect();
        let want: Vec<String> = c.output["result"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap().to_string())
            .collect();
        hits += want.len();
        if got != want {
            let at = got.iter().zip(&want).position(|(a, b)| a != b);
            eprintln!(
                "{}: {} vs {} hits, first difference at {at:?}: {:?} vs {:?}",
                c.id,
                got.len(),
                want.len(),
                at.map(|i| &got[i..(i + 3).min(got.len())]),
                at.map(|i| &want[i..(i + 3).min(want.len())])
            );
            mismatches.push(c.id.clone());
        }
    }
    eprintln!(
        "{} searches, {hits} hits in total, {} differ from FAISS",
        g.cases.len(),
        mismatches.len()
    );
    assert!(mismatches.is_empty(), "differ: {mismatches:?}");
}

fn vecs(n: usize, seed: u32) -> (Vec<String>, Vec<Vec<f32>>) {
    let hashes = (0..n).map(|i| format!("{seed}-{i:05}")).collect();
    let embs = (0..n)
        .map(|i| {
            (0..512)
                .map(|j| (((i * 31 + j * 7) as u32 ^ seed) % 97) as f32 / 10.0)
                .collect()
        })
        .collect();
    (hashes, embs)
}

#[tokio::test]
async fn rebuild_contract_delete_and_persistence() {
    let dir = tempfile::tempdir().unwrap();
    let ml = ml(dir.path());
    let sc = sidecars();
    let view = ml.view(&sc);
    let sim = view.similarity();

    // No index yet: no hits, not an error.
    let q = vec![1.0f32; 512];
    assert!(
        sim.search(3, &q, None, 0.0)
            .await
            .unwrap()
            .result
            .is_empty()
    );

    let (h, e) = vecs(12, 1);
    assert_eq!(rebuild(&ml, 3, &h, &e, 5).await, 12);
    assert_eq!(lp_ml::similarity::stored_len(dir.path(), 3), Some(12));
    assert_eq!(
        sim.search(3, &q, Some(4), 0.0).await.unwrap().result.len(),
        4
    );

    // A page without `begin` and no rebuild running is an incremental add.
    let (h2, e2) = vecs(2, 9);
    let r = sim
        .build(&SimilarityBuild {
            user_id: 3,
            image_hashes: &h2,
            image_embeddings: &e2,
            begin: false,
            commit: false,
        })
        .await
        .unwrap();
    assert_eq!(r.index_size, Some(14));

    // A staged rebuild does not replace the live index until commit, and a
    // bad page abandons it (400) leaving the old one in place.
    let r = sim
        .build(&SimilarityBuild {
            user_id: 3,
            image_hashes: &h[..3],
            image_embeddings: &e[..3],
            begin: true,
            commit: false,
        })
        .await
        .unwrap();
    assert_eq!(r.index_size, Some(3));
    assert_eq!(lp_ml::similarity::stored_len(dir.path(), 3), Some(14));
    let bad = vec![vec![0.0f32; 7]];
    let err = sim
        .build(&SimilarityBuild {
            user_id: 3,
            image_hashes: &h[..1],
            image_embeddings: &bad,
            begin: false,
            commit: true,
        })
        .await
        .unwrap_err();
    assert!(
        matches!(err, SidecarError::Status { status: 400, .. }),
        "{err:?}"
    );
    assert!(err.detail().contains("abandoned"), "{}", err.detail());
    // The abandoned rebuild is gone: a commit alone is refused.
    let err = sim
        .build(&SimilarityBuild {
            user_id: 3,
            image_hashes: &[],
            image_embeddings: &[],
            begin: false,
            commit: true,
        })
        .await
        .unwrap_err();
    assert!(
        err.detail().contains("no rebuild in progress"),
        "{}",
        err.detail()
    );
    assert_eq!(sim.search(3, &q, None, 0.0).await.unwrap().result.len(), 14);

    // An empty rebuild empties the index.
    assert_eq!(rebuild(&ml, 3, &[], &[], 5).await, 0);
    assert!(
        sim.search(3, &q, None, 0.0)
            .await
            .unwrap()
            .result
            .is_empty()
    );

    // Another process's rebuild is picked up by the next search.
    let other = self::ml(dir.path());
    assert_eq!(rebuild(&other, 3, &h, &e, 100).await, 12);
    assert_eq!(sim.search(3, &q, None, 0.0).await.unwrap().result.len(), 12);

    // Wrong query size: the sidecar's 500.
    let err = sim.search(3, &q[..10], None, 0.0).await.unwrap_err();
    assert!(
        matches!(err, SidecarError::Status { status: 500, .. }),
        "{err:?}"
    );

    sim.delete(3).await.unwrap();
    assert_eq!(lp_ml::similarity::stored_len(dir.path(), 3), None);
    assert!(
        sim.search(3, &q, None, 0.0)
            .await
            .unwrap()
            .result
            .is_empty()
    );
    sim.delete(3).await.unwrap();
}
