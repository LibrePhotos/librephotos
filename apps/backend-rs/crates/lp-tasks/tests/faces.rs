//! faces.scan / faces.cluster / faces.train on a fixture clone against the
//! mock sidecars.

#![allow(clippy::disallowed_methods, clippy::type_complexity)]

mod common;

use common::*;
use lp_core::codecs::FaceEncoding;
use lp_jobs::{EnqueueOptions, JobType};
use serde_json::json;
use uuid::Uuid;

#[derive(Debug, sqlx::FromRow)]
struct FaceRow {
    id: i32,
    person_id: Option<i32>,
    cluster_id: Option<i32>,
    cluster_person_id: Option<i32>,
    classification_person_id: Option<i32>,
    cluster_probability: f64,
    classification_probability: f64,
    image: Option<String>,
    encoding: String,
}

async fn faces_of(db: &sqlx::PgPool, owner: i32) -> Vec<FaceRow> {
    sqlx::query_as::<_, FaceRow>(
        "SELECT f.id, f.person_id, f.cluster_id, f.cluster_person_id, f.classification_person_id, \
           f.cluster_probability, f.classification_probability, f.image, f.encoding \
         FROM api_face f JOIN api_photo p ON p.id = f.photo_id WHERE p.owner_id = $1 ORDER BY f.id",
    )
    .bind(owner)
    .fetch_all(db)
    .await
    .unwrap()
}

async fn latest_job(db: &sqlx::PgPool, job_type: i32) -> Option<String> {
    sqlx::query_scalar(
        "SELECT job_id FROM api_longrunningjob WHERE job_type = $1 ORDER BY id DESC LIMIT 1",
    )
    .bind(job_type)
    .fetch_optional(db)
    .await
    .unwrap()
}

#[tokio::test]
async fn scan_detects_crops_encodes_clusters_and_trains() {
    let t = TasksApp::new().await;
    t.copy_thumbnails();
    let db = t.db().clone();
    let alice = user_id(&db, "alice").await;
    let before = faces_of(&db, alice).await;

    let (res, lrj) = run_job(
        &t.state,
        "faces.scan",
        json!({"user_id": alice}),
        EnqueueOptions::tracked(JobType::ScanFaces, alice),
    )
    .await;
    res.unwrap();
    let j = job(&db, lrj.as_deref().unwrap()).await;
    let with_thumb: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM api_photo p JOIN api_thumbnail t ON t.photo_id = p.id WHERE p.owner_id = $1",
    )
    .bind(alice)
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(j.job_type, 7);
    assert_eq!(j.progress_target as i64, with_thumb);
    assert!(j.finished, "{j:?}");

    let after = faces_of(&db, alice).await;
    let new: Vec<&FaceRow> = after
        .iter()
        .filter(|f| f.id > before.last().unwrap().id)
        .collect();
    assert!(!new.is_empty());
    for f in &new {
        let image = f.image.as_deref().unwrap();
        assert!(
            image.starts_with("faces/") && image.ends_with(".jpg"),
            "{image}"
        );
        let file = lp_tasks::photos::media_path(&t.state.config.media_root, image);
        let crop = image::open(&file).expect("face crop written");
        assert!(crop.width() > 0);
        // Every face got an encoding: from detection, or the back-fill job.
        assert_eq!(f.encoding.len(), 512 * 16, "face {}", f.id);
        assert!(f.person_id.is_none());
    }
    // Some mock images come without encodings: the back-fill ran as its own job.
    if !t.mock.calls_to("/face-encodings").is_empty() {
        let emb = latest_job(&db, 13).await.expect("embeddings job");
        let ej = job(&db, &emb).await;
        assert!(
            ej.finished && ej.progress_current == ej.progress_target,
            "{ej:?}"
        );
    }
    // Clustering ran and queued training.
    let cj = job(&db, &latest_job(&db, 8).await.expect("cluster job")).await;
    assert!(cj.finished && !cj.failed, "{cj:?}");
    assert_eq!(t.mock.calls_to("/cluster").len(), 1);
    run_queued(&t.state, "faces.train")
        .await
        .expect("train queued")
        .unwrap();
    let tj = job(&db, &latest_job(&db, 4).await.expect("train job")).await;
    assert!(tj.finished && !tj.failed, "{tj:?}");

    // A second scan finds the same faces again and keeps them once.
    let count = after.len();
    let (res, _) = run_job(
        &t.state,
        "faces.scan",
        json!({"user_id": alice, "full_scan": true}),
        EnqueueOptions::tracked(JobType::ScanFaces, alice),
    )
    .await;
    res.unwrap();
    assert_eq!(faces_of(&db, alice).await.len(), count);
    t.cleanup().await;
}

#[tokio::test]
async fn xmp_regions_name_faces() {
    let Some(_) = exiftool() else {
        eprintln!("no exiftool on this machine; skipping");
        return;
    };
    let t = TasksApp::new().await;
    t.copy_thumbnails();
    let db = t.db().clone();
    let alice = user_id(&db, "alice").await;
    let m = manifest();
    let key = "alice/e2e_03";
    let photo: Uuid = m["photos"][key]["id"].as_str().unwrap().parse().unwrap();
    let main = m["photos"][key]["main_file"].as_str().unwrap();

    // The photo's file, moved next to an XMP sidecar with one face region.
    let dir = t.app.base_path().join("xmp");
    std::fs::create_dir_all(&dir).unwrap();
    let copy = dir.join("region.jpg");
    std::fs::copy(main, &copy).unwrap();
    std::fs::write(dir.join("region.xmp"), include_str!("region.xmp")).unwrap();
    sqlx::query("UPDATE api_file SET path = $2 WHERE hash = (SELECT main_file_id FROM api_photo WHERE id = $1)")
        .bind(photo)
        .bind(path_of(&copy))
        .execute(&db)
        .await
        .unwrap();
    sqlx::query(
        "UPDATE api_person SET cover_face_id = NULL WHERE cover_face_id IN (SELECT id FROM api_face WHERE photo_id = $1)",
    )
    .bind(photo)
    .execute(&db)
    .await
    .unwrap();
    sqlx::query("DELETE FROM api_face WHERE photo_id = $1")
        .bind(photo)
        .execute(&db)
        .await
        .unwrap();

    let p = lp_tasks::photos::load_one(&db, photo)
        .await
        .unwrap()
        .unwrap();
    let saved = lp_tasks::faces::extract_faces(&t.state, &p).await.unwrap();
    assert_eq!(saved, 1);
    assert!(
        t.mock.calls_to("/face-locations").is_empty(),
        "XMP regions win over the sidecar"
    );
    let (person, kind, owner, face_count, cover): (i32, String, i32, i32, Option<Uuid>) = sqlx::query_as(
        "SELECT id, kind, cluster_owner_id, face_count, cover_photo_id FROM api_person WHERE name = 'Carla Xmp'",
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(
        (kind.as_str(), owner, face_count, cover),
        ("USER", alice, 1, Some(photo))
    );
    let (face_person, encoding, top, left): (Option<i32>, String, i32, i32) = sqlx::query_as(
        "SELECT person_id, encoding, location_top, location_left FROM api_face WHERE photo_id = $1",
    )
    .bind(photo)
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(face_person, Some(person));
    assert_eq!(encoding, "", "XMP faces get their encoding later");
    let big = p.thumbnail_path(&t.state.config.media_root).unwrap();
    let (w, h) = image::image_dimensions(&big).unwrap();
    // x=0.5 y=0.4 w=0.2 h=0.3 (normalized)
    assert_eq!(top, ((0.4 * h as f64) - (0.3 * h as f64) / 2.0) as i32);
    assert_eq!(left, ((0.5 * w as f64) - (0.2 * w as f64) / 2.0) as i32);

    lp_tasks::faces::generate_face_embeddings(&t.state, alice)
        .await
        .unwrap();
    let encoding: String = sqlx::query_scalar("SELECT encoding FROM api_face WHERE photo_id = $1")
        .bind(photo)
        .fetch_one(&db)
        .await
        .unwrap();
    assert_eq!(FaceEncoding::decode(&encoding).unwrap().len(), 512);

    // Again: the region overlaps the face it made, nothing new.
    assert_eq!(
        lp_tasks::faces::extract_faces(&t.state, &p).await.unwrap(),
        0
    );
    t.cleanup().await;
}

#[tokio::test]
async fn cluster_and_train_follow_face_classify() {
    let t = TasksApp::new().await;
    let db = t.db().clone();
    let alice = user_id(&db, "alice").await;
    let m = manifest();
    let ids = |k: &str| -> Vec<i32> {
        m["faces"][k]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_i64().unwrap() as i32)
            .collect()
    };
    let anna = m["persons"]["anna"]["id"].as_i64().unwrap() as i32;
    let ben = m["persons"]["ben"]["id"].as_i64().unwrap() as i32;
    let old_cluster_person = m["persons"]["cluster_1"]["id"].as_i64().unwrap() as i32;

    // Alice's encoded faces in id order, labelled: Anna's + the deleted one
    // -> 0, Ben's + the inferred Ben -> 1, cluster_1's -> 2, unknown -> -1.
    let faces = faces_of(&db, alice).await;
    let labels: Vec<i64> = faces
        .iter()
        .map(|f| {
            if ids("anna").contains(&f.id) || ids("deleted").contains(&f.id) {
                0
            } else if ids("ben").contains(&f.id) || ids("inferred_ben").contains(&f.id) {
                1
            } else if ids("cluster_1").contains(&f.id) {
                2
            } else {
                -1
            }
        })
        .collect();
    t.mock.knobs.lock().unwrap().cluster_labels = Some(labels);

    let (res, lrj) = run_job(
        &t.state,
        "faces.cluster",
        json!({"user_id": alice}),
        EnqueueOptions::tracked(JobType::ClusterAllFaces, alice),
    )
    .await;
    res.unwrap();
    let j = job(&db, lrj.as_deref().unwrap()).await;
    assert!(j.finished && !j.failed, "{j:?}");
    assert_eq!(j.progress_target as usize, faces.len());
    let sent = &t.mock.calls_to("/cluster")[0];
    assert_eq!(sent["min_cluster_size"], 2);
    assert_eq!(sent["faces"].as_array().unwrap().len(), faces.len());

    // The old CLUSTER person is gone; a new one per unlabelled group.
    let gone: i64 = sqlx::query_scalar("SELECT count(*) FROM api_person WHERE id = $1")
        .bind(old_cluster_person)
        .fetch_one(&db)
        .await
        .unwrap();
    assert_eq!(gone, 0);
    let (unknown3, kind): (i32, String) = sqlx::query_as(
        "SELECT id, kind FROM api_person WHERE name = 'Unknown 3' AND cluster_owner_id = $1",
    )
    .bind(alice)
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(kind, "CLUSTER");

    let clusters: Vec<(i32, Option<i32>, Option<String>, Option<i32>, String)> = sqlx::query_as(
        "SELECT id, cluster_id, name, person_id, mean_face_encoding FROM api_cluster WHERE owner_id = $1 ORDER BY id",
    )
    .bind(alice)
    .fetch_all(&db)
    .await
    .unwrap();
    let find = |name: &str| {
        clusters
            .iter()
            .find(|c| c.2.as_deref() == Some(name))
            .unwrap_or_else(|| panic!("{name}: {clusters:?}"))
    };
    let c_anna = find("Cluster 1-1");
    assert_eq!((c_anna.1, c_anna.3), (Some(1), Some(anna)));
    let c_ben = find("Cluster 2-1");
    assert_eq!((c_ben.1, c_ben.3), (Some(2), Some(ben)));
    let c3 = find("Cluster 3");
    assert_eq!((c3.1, c3.3), (Some(3), Some(unknown3)));
    let unknown = clusters
        .iter()
        .find(|c| c.1 == Some(-1))
        .expect("unknown cluster");
    assert_eq!(
        (unknown.2.as_deref(), unknown.3, unknown.4.as_str()),
        (None, None, "")
    );

    // Mean encoding of Anna's non-deleted faces, numpy style.
    let after = faces_of(&db, alice).await;
    let anna_encodings: Vec<Vec<f64>> = after
        .iter()
        .filter(|f| ids("anna").contains(&f.id))
        .map(|f| FaceEncoding::decode(&f.encoding).unwrap())
        .collect();
    assert_eq!(
        c_anna.4,
        FaceEncoding::encode(&lp_tasks::faces::cluster::mean_encoding(&anna_encodings))
    );
    for f in &after {
        if ids("anna").contains(&f.id) {
            assert_eq!(f.cluster_id, Some(c_anna.0));
        } else if ids("ben").contains(&f.id) {
            assert_eq!(f.cluster_id, Some(c_ben.0));
        } else if ids("inferred_ben").contains(&f.id) || ids("deleted").contains(&f.id) {
            assert_eq!(f.cluster_id, None, "left out of its group like Django does");
        } else if ids("cluster_1").contains(&f.id) {
            assert_eq!(
                (f.cluster_id, f.cluster_person_id),
                (Some(c3.0), Some(unknown3))
            );
        } else if ids("unknown").contains(&f.id) {
            assert_eq!((f.cluster_id, f.cluster_person_id), (Some(unknown.0), None));
        }
    }

    // Training was queued; the mock predicts the first cluster person and
    // the first labelled person for every unlabelled face.
    run_queued(&t.state, "faces.train")
        .await
        .expect("queued")
        .unwrap();
    let train_req = &t.mock.calls_to("/train")[0];
    let unknown_ids: Vec<i64> = train_req["unknown"]
        .as_array()
        .unwrap()
        .iter()
        .map(|u| u["id"].as_i64().unwrap())
        .collect();
    assert!(
        !unknown_ids.contains(&(ids("deleted")[0] as i64)),
        "deleted faces are not predicted"
    );
    assert_eq!(train_req["clusters"].as_array().unwrap().len(), 1);
    let first_known = train_req["known"][0]["person_id"].as_i64().unwrap() as i32;
    for f in faces_of(&db, alice).await {
        if !unknown_ids.contains(&(f.id as i64)) {
            continue;
        }
        assert_eq!(f.classification_person_id, Some(first_known));
        assert_eq!(f.classification_probability, 0.6);
        if f.cluster_id == Some(unknown.0) {
            assert_eq!((f.cluster_person_id, f.cluster_probability), (None, 0.0));
        } else {
            assert_eq!(
                (f.cluster_person_id, f.cluster_probability),
                (Some(unknown3), 0.75)
            );
        }
    }
    let tj = job(&db, &latest_job(&db, 4).await.unwrap()).await;
    assert!(tj.finished && !tj.failed);
    assert_eq!(tj.progress_current as usize, unknown_ids.len());
    t.cleanup().await;
}

#[tokio::test]
async fn cluster_failures_and_flags() {
    let t = TasksApp::new().await;
    let db = t.db().clone();
    let alice = user_id(&db, "alice").await;
    t.mock.knobs.lock().unwrap().fail = vec![(
        "/cluster".into(),
        500,
        json!({"error": "boom from hdbscan"}),
    )];
    let (res, lrj) = run_job(
        &t.state,
        "faces.cluster",
        json!({"user_id": alice}),
        EnqueueOptions::tracked(JobType::ClusterAllFaces, alice),
    )
    .await;
    res.unwrap();
    let j = job(&db, lrj.as_deref().unwrap()).await;
    assert!(j.failed && j.finished);
    assert_eq!(
        j.result.unwrap(),
        json!({"status": "failed", "error": "boom from hdbscan"})
    );
    assert!(run_queued(&t.state, "faces.train").await.is_none());

    t.mock.knobs.lock().unwrap().fail = vec![(
        "/train".into(),
        500,
        json!({"error": "no known faces", "type": "ValueError"}),
    )];
    let (res, lrj) = run_job(
        &t.state,
        "faces.train",
        json!({"user_id": alice}),
        EnqueueOptions::tracked(JobType::TrainFaces, alice),
    )
    .await;
    res.unwrap();
    let j = job(&db, lrj.as_deref().unwrap()).await;
    assert_eq!(
        j.result.unwrap(),
        json!({"status": "failed", "error": "no known faces"})
    );
    t.cleanup().await;

    let t = TasksApp::with_env(&[("FEATURE_FACE_CLUSTER", "0")]).await;
    let db = t.db().clone();
    let alice = user_id(&db, "alice").await;
    let (res, lrj) = run_job(
        &t.state,
        "faces.cluster",
        json!({"user_id": alice}),
        EnqueueOptions::tracked(JobType::ClusterAllFaces, alice),
    )
    .await;
    res.unwrap();
    assert!(job(&db, lrj.as_deref().unwrap()).await.finished);
    assert!(t.mock.calls_to("/cluster").is_empty());
    t.cleanup().await;
}

#[test]
fn every_kind_is_registered_once() {
    let reg = registry();
    assert_eq!(
        reg.kinds(),
        vec![
            "captions.generate",
            "clip.embed",
            "faces.cluster",
            "faces.scan",
            "faces.train",
            "geo.locate",
            "media.classify",
            "ocr.generate",
            "similarity.build",
            "tags.generate",
        ]
    );
}
