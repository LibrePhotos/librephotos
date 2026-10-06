//! faces.cluster + faces.train end to end with the in-process face_cluster
//! service on a fixture clone. With `LP_FC_SIDECAR_URL` pointing at a
//! running face_cluster sidecar (`SERVICE_PORT=<port> python
//! apps/backend-rs/sidecars/face_cluster/main.py`), the same jobs also run
//! through it on a second clone and the resulting rows must be identical.

#![allow(clippy::disallowed_methods, clippy::type_complexity)]

mod common;

use common::*;
use lp_db::db::Db;
use lp_jobs::{EnqueueOptions, JobType};
use lp_ml::{Mode, Service};
use lp_sidecars::Sidecar;
use serde_json::json;

/// Everything the two jobs write, keyed by names (row ids may differ).
#[derive(Debug, PartialEq)]
struct Snapshot {
    faces: Vec<(
        i32,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<i32>,
        String,
        String,
    )>,
    clusters: Vec<(Option<String>, Option<i32>, Option<String>, String)>,
    persons: Vec<(String, String)>,
    jobs: Vec<(i32, bool, bool)>,
}

async fn snapshot(db: &Db, owner: i32) -> Snapshot {
    // Probabilities to 6 places and a digest of the means, computed here so
    // the query runs on both dialects.
    let faces: Vec<(
        i32,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<i32>,
        f64,
        f64,
    )> = lp_db::sql::query_as(
        "SELECT f.id, c.name, cp.name, clp.name, f.person_id, \
               f.cluster_probability, f.classification_probability \
             FROM api_face f JOIN api_photo p ON p.id = f.photo_id \
             LEFT JOIN api_cluster c ON c.id = f.cluster_id \
             LEFT JOIN api_person cp ON cp.id = f.cluster_person_id \
             LEFT JOIN api_person clp ON clp.id = f.classification_person_id \
             WHERE p.owner_id = $1 ORDER BY f.id",
    )
    .bind(owner)
    .fetch_all(db)
    .await
    .unwrap();
    let faces = faces
        .into_iter()
        .map(|(id, c, cp, clp, person, cprob, clprob)| {
            (
                id,
                c,
                cp,
                clp,
                person,
                format!("{cprob:.6}"),
                format!("{clprob:.6}"),
            )
        })
        .collect();
    let clusters: Vec<(Option<String>, Option<i32>, Option<String>, String)> =
        lp_db::sql::query_as(
            "SELECT c.name, c.cluster_id, pe.name, c.mean_face_encoding FROM api_cluster c \
             LEFT JOIN api_person pe ON pe.id = c.person_id WHERE c.owner_id = $1 \
             ORDER BY c.cluster_id, c.name",
        )
        .bind(owner)
        .fetch_all(db)
        .await
        .unwrap();
    let clusters = clusters
        .into_iter()
        .map(|(name, cid, person, mean)| {
            use std::hash::{Hash, Hasher};
            let mut h = std::collections::hash_map::DefaultHasher::new();
            mean.hash(&mut h);
            (name, cid, person, format!("{:016x}", h.finish()))
        })
        .collect();
    let persons = lp_db::sql::query_as(
        "SELECT name, kind FROM api_person WHERE cluster_owner_id = $1 OR kind = 'USER' ORDER BY name, kind",
    )
    .bind(owner)
    .fetch_all(db)
    .await
    .unwrap();
    let jobs = lp_db::sql::query_as(
        "SELECT job_type, finished, failed FROM api_longrunningjob \
         WHERE job_type IN (4, 8) ORDER BY id",
    )
    .fetch_all(db)
    .await
    .unwrap();
    Snapshot {
        faces,
        clusters,
        persons,
        jobs,
    }
}

/// The faces the user put on a person (a `USER` person): face id -> person.
async fn labelled(db: &Db, owner: i32) -> Vec<(i32, i32)> {
    lp_db::sql::query_as(
        "SELECT f.id, f.person_id FROM api_face f JOIN api_photo p ON p.id = f.photo_id \
         JOIN api_person pe ON pe.id = f.person_id \
         WHERE p.owner_id = $1 AND pe.kind = 'USER' ORDER BY f.id",
    )
    .bind(owner)
    .fetch_all(db)
    .await
    .unwrap()
}

async fn cluster_and_train(t: &TasksApp, user: i32) -> Snapshot {
    let (res, lrj) = run_job(
        &t.state,
        "faces.cluster",
        json!({"user_id": user}),
        EnqueueOptions::tracked(JobType::ClusterAllFaces, user),
    )
    .await;
    res.unwrap();
    let j = job(t.db(), lrj.as_deref().unwrap()).await;
    assert!(j.finished && !j.failed, "{j:?}");
    run_queued(&t.state, "faces.train")
        .await
        .expect("train queued")
        .unwrap();
    snapshot(t.db(), user).await
}

#[tokio::test]
async fn cluster_and_train_in_process() {
    let t = TasksApp::new().await;
    t.state.ml.set_mode(Service::FaceCluster, Mode::InProcess);
    let alice = user_id(t.db(), "alice").await;
    let before = labelled(t.db(), alice).await;
    assert!(!before.is_empty(), "the fixture has labelled faces");
    let ours = cluster_and_train(&t, alice).await;
    assert_eq!(
        labelled(t.db(), alice).await,
        before,
        "user-labelled faces keep their person"
    );
    assert!(
        t.mock.calls_to("/cluster").is_empty() && t.mock.calls_to("/train").is_empty(),
        "the sidecar was not called"
    );
    // Every encoded, non-deleted face got a cluster; the trained faces have
    // a cluster person and a probability.
    assert!(ours.faces.iter().any(|f| f.1.is_some()), "{ours:#?}");
    assert!(ours.jobs.iter().all(|j| j.1 && !j.2), "{:?}", ours.jobs);
    eprintln!("{ours:#?}");

    let Ok(url) = std::env::var("LP_FC_SIDECAR_URL") else {
        eprintln!("LP_FC_SIDECAR_URL unset: not comparing with the Python sidecar");
        t.cleanup().await;
        return;
    };
    let mut py = TasksApp::new().await;
    py.state.sidecars = py.state.sidecars.with_base(Sidecar::FaceCluster, &url);
    py.state.ml.set_mode(Service::FaceCluster, Mode::Sidecar);
    let theirs = cluster_and_train(&py, alice).await;
    assert_eq!(ours, theirs, "in-process vs sidecar");
    eprintln!(
        "identical to the Python sidecar: {} faces, {} clusters, {} persons",
        ours.faces.len(),
        ours.clusters.len(),
        ours.persons.len()
    );
    py.cleanup().await;
    t.cleanup().await;
}
