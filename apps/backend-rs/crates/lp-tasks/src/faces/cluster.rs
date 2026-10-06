//! `faces.cluster` (`face_classify.cluster_all_faces` + `ClusterManager`) and
//! `faces.train` (`face_classify.train_faces`). HDBSCAN and the MLP
//! classifiers run in the face_cluster service (`lp_ml::face_cluster`,
//! in-process or the sidecar); every read and write is here.

use std::collections::{BTreeMap, HashMap};

use lp_core::AppState;
use lp_core::codecs::FaceEncoding;
use lp_db::db::Conn;
use lp_jobs::{EnqueueOptions, JobType};
use lp_sidecars::{ClusterFace, ClusterRequest, LabelledEncoding, SidecarError, TrainRequest};
use sqlx::FromRow;

use super::unknown_cluster;
use crate::run;

pub const UNKNOWN_CLUSTER_ID: i64 = -1;

/// `resolve_min_cluster_size`: the user's setting when valid, else doubled
/// for every 10x more faces.
pub fn resolve_min_cluster_size(user_setting: i32, target_count: usize) -> i32 {
    if !matches!(user_setting, 0 | 1) {
        return user_setting;
    }
    match target_count {
        n if n > 100_000 => 16,
        n if n > 10_000 => 8,
        n if n > 1_000 => 4,
        _ => 2,
    }
}

/// `Cluster.calculate_mean_face_encoding`: numpy's axis-0 mean (a
/// sequential sum from the first row, then one division), bit for bit.
pub fn mean_encoding(rows: &[Vec<f64>]) -> Vec<f64> {
    let Some(first) = rows.first() else {
        return Vec::new();
    };
    let mut acc = first.clone();
    for row in &rows[1..] {
        for (a, v) in acc.iter_mut().zip(row) {
            *a += *v;
        }
    }
    let n = rows.len() as f64;
    acc.iter_mut().for_each(|a| *a /= n);
    acc
}

#[derive(Debug, FromRow)]
struct UserClusterSettings {
    min_cluster_size: i32,
    min_samples: i32,
    cluster_selection_epsilon: f64,
}

/// `cluster_all_faces`: drop the user's clusters and cluster persons (and
/// every face-less user-labelled person, as Django does), cluster all
/// encodings anew and queue `faces.train`. Returns false when face
/// clustering is disabled or the job failed (the failure is on the job).
pub async fn cluster_all_faces(
    state: &AppState,
    user_id: i32,
    lrj_id: Option<&str>,
) -> anyhow::Result<bool> {
    if !state.config.features.face_cluster {
        tracing::info!("face clustering is disabled");
        if let Some(id) = lrj_id {
            run::complete(&state.db, id).await?;
        }
        return Ok(false);
    }
    let job_id = run::begin(&state.db, lrj_id, JobType::ClusterAllFaces, user_id).await?;
    run::set_progress(&state.db, &job_id, 0, 1).await?;
    match create_all_clusters(state, user_id).await {
        Ok(target) => {
            let target = i32::try_from(target).unwrap_or(i32::MAX);
            run::set_progress(&state.db, &job_id, target, target).await?;
            run::complete(&state.db, &job_id).await?;
            lp_jobs::enqueue(
                state,
                "faces.train",
                serde_json::json!({"user_id": user_id}),
                EnqueueOptions::tracked(JobType::TrainFaces, user_id),
            )
            .await?;
            Ok(true)
        }
        Err(e) => {
            tracing::error!(error = %e, "face clustering failed");
            run::fail(&state.db, &job_id, &e.to_string()).await?;
            Ok(false)
        }
    }
}

async fn deleted_user_id(conn: &mut Conn) -> sqlx::Result<Option<i32>> {
    lp_db::sql::query_scalar(
        "SELECT id FROM api_user WHERE username = 'deleted' ORDER BY id LIMIT 1",
    )
    .fetch_optional(conn)
    .await
}

/// Delete persons the way Django's collector + `reset_person` do: faces
/// lose them as `person` (S3), `classification_person`, `cluster_person`,
/// clusters as `person`. `USER` persons with an owner leave a mobile-sync
/// tombstone (`_person_tombstone`).
async fn delete_persons(conn: &mut Conn, ids: &[i32]) -> sqlx::Result<()> {
    if ids.is_empty() {
        return Ok(());
    }
    lp_db::write::deletion_log::persons_deleted(conn, ids).await?;
    for sql in [
        "UPDATE api_face SET person_id = NULL WHERE person_id = ANY($1)",
        "UPDATE api_face SET classification_person_id = NULL WHERE classification_person_id = ANY($1)",
        "UPDATE api_face SET cluster_person_id = NULL WHERE cluster_person_id = ANY($1)",
        "UPDATE api_cluster SET person_id = NULL WHERE person_id = ANY($1)",
        "DELETE FROM api_person WHERE id = ANY($1)",
    ] {
        lp_db::sql::query(sql).bind(ids).execute(&mut *conn).await?;
    }
    Ok(())
}

/// `delete_clustered_people`, `delete_clusters`, `delete_persons_without_faces`.
async fn reset_clusters(conn: &mut Conn, user_id: i32) -> sqlx::Result<()> {
    let deleted = deleted_user_id(conn).await?;
    let people: Vec<i32> = lp_db::sql::query_scalar(
        "SELECT id FROM api_person WHERE (kind IN ('CLUSTER', 'UNKNOWN') AND cluster_owner_id = $1) \
           OR cluster_owner_id IS NULL OR cluster_owner_id = $2",
    )
    .bind(user_id)
    .bind(deleted)
    .fetch_all(&mut *conn)
    .await?;
    delete_persons(conn, &people).await?;

    let clusters: Vec<i32> = lp_db::sql::query_scalar(
        "SELECT id FROM api_cluster WHERE owner_id = $1 OR owner_id IS NULL OR owner_id = $2",
    )
    .bind(user_id)
    .bind(deleted)
    .fetch_all(&mut *conn)
    .await?;
    if !clusters.is_empty() {
        lp_db::sql::query("UPDATE api_face SET cluster_id = NULL WHERE cluster_id = ANY($1)")
            .bind(&clusters)
            .execute(&mut *conn)
            .await?;
        lp_db::sql::query("DELETE FROM api_cluster WHERE id = ANY($1)")
            .bind(&clusters)
            .execute(&mut *conn)
            .await?;
    }

    let faceless: Vec<i32> = lp_db::sql::query_scalar(
        "SELECT pe.id FROM api_person pe WHERE pe.kind = 'USER' \
           AND NOT EXISTS (SELECT 1 FROM api_face f WHERE f.person_id = pe.id)",
    )
    .fetch_all(&mut *conn)
    .await?;
    delete_persons(conn, &faceless).await
}

#[derive(Debug, FromRow)]
struct FaceRow {
    id: i32,
    person_id: Option<i32>,
    encoding: String,
}

fn decode(id: i32, encoding: &str) -> anyhow::Result<Vec<f64>> {
    FaceEncoding::decode(encoding).map_err(|e| anyhow::anyhow!("face {id}: {e}"))
}

/// CPU work inside an async job: on a multi-thread runtime the worker hands
/// its other tasks off first.
fn off_runtime<T>(f: impl FnOnce() -> T) -> T {
    match tokio::runtime::Handle::try_current() {
        Ok(h) if h.runtime_flavor() == tokio::runtime::RuntimeFlavor::MultiThread => {
            tokio::task::block_in_place(f)
        }
        _ => f(),
    }
}

/// `create_all_clusters`; returns the number of encodings clustered.
async fn create_all_clusters(state: &AppState, user_id: i32) -> anyhow::Result<usize> {
    let mut tx = state.db.begin().await?;
    reset_clusters(&mut tx, user_id).await?;

    // `collect_face_encodings`: deleted faces take part in the fit.
    let rows = lp_db::sql::query_as::<_, FaceRow>(
        "SELECT f.id, f.person_id, f.encoding FROM api_face f JOIN api_photo p ON p.id = f.photo_id \
         WHERE p.owner_id = $1 AND f.encoding IS NOT NULL AND f.encoding <> '' ORDER BY f.id",
    )
    .bind(user_id)
    .fetch_all(&mut *tx)
    .await?;
    let mut faces: Vec<ClusterFace> = Vec::with_capacity(rows.len());
    let mut expected_len = None;
    for row in rows {
        let len = row.encoding.trim().len();
        match expected_len {
            None => expected_len = Some(len),
            Some(l) if l != len => {
                tracing::warn!(
                    face = row.id,
                    "skipping face: encoding length differs (model changed?)"
                );
                continue;
            }
            _ => {}
        }
        faces.push(ClusterFace {
            id: row.id,
            encoding: row.encoding,
        });
    }
    // Every encoding must decode (as numpy's would): hundreds of MB of hex for
    // a big library, so not on a runtime worker.
    off_runtime(|| {
        faces
            .iter()
            .try_for_each(|f| decode(f.id, &f.encoding).map(drop))
    })?;
    let target = faces.len();
    if target == 0 {
        tx.commit().await?;
        return Ok(0);
    }

    let settings = lp_db::sql::query_as::<_, UserClusterSettings>(
        "SELECT min_cluster_size, min_samples, cluster_selection_epsilon FROM api_user WHERE id = $1",
    )
    .bind(user_id)
    .fetch_one(&mut *tx)
    .await?;
    let ids: Vec<i32> = faces.iter().map(|f| f.id).collect();
    let request = ClusterRequest {
        faces,
        min_cluster_size: resolve_min_cluster_size(settings.min_cluster_size, target),
        min_samples: if settings.min_samples > 0 {
            settings.min_samples
        } else {
            1
        },
        cluster_selection_epsilon: settings.cluster_selection_epsilon,
    };
    let labels = state
        .ml()
        .face_cluster()
        .cluster(&request)
        .await
        .map_err(sidecar_failure)?
        .labels;

    let mut groups: BTreeMap<i64, Vec<i32>> = BTreeMap::new();
    for (id, label) in ids.iter().zip(&labels) {
        groups.entry(*label).or_default().push(*id);
    }
    let pad = groups.len().to_string().len();
    let mut order: Vec<(i64, Vec<i32>)> = groups.into_iter().collect();
    order.sort_by_key(|g| std::cmp::Reverse(g.1.len()));

    let unknown = unknown_cluster(&mut tx, user_id).await?;
    let mut cluster_count = 0i64;
    let mut created = 0usize;
    for (label, face_ids) in order {
        let cluster_id = if label == UNKNOWN_CLUSTER_ID {
            UNKNOWN_CLUSTER_ID
        } else {
            cluster_count += 1;
            cluster_count
        };
        let members = lp_db::sql::query_as::<_, FaceRow>(
            "SELECT id, person_id, encoding FROM api_face \
             WHERE id = ANY($1) AND encoding IS NOT NULL AND NOT deleted ORDER BY id",
        )
        .bind(&face_ids)
        .fetch_all(&mut *tx)
        .await?;
        created += add_cluster(&mut tx, user_id, unknown, cluster_id, &members, pad).await?;
    }
    tx.commit().await?;
    tracing::info!(clusters = created, faces = target, "created face clusters");
    Ok(target)
}

/// (person, cluster row, face ids, their encodings) of `_split_by_person`.
type PersonCluster = (i32, i32, Vec<i32>, Vec<Vec<f64>>);

/// `ClusterManager.try_add_cluster`; returns the number of clusters made.
async fn add_cluster(
    conn: &mut Conn,
    user_id: i32,
    unknown: i32,
    cluster_id: i64,
    faces: &[FaceRow],
    pad: usize,
) -> anyhow::Result<usize> {
    let known: Vec<&FaceRow> = faces.iter().filter(|f| f.person_id.is_some()).collect();
    let unknown_faces: Vec<&FaceRow> = faces.iter().filter(|f| f.person_id.is_none()).collect();

    if cluster_id == UNKNOWN_CLUSTER_ID {
        let ids: Vec<i32> = unknown_faces.iter().map(|f| f.id).collect();
        lp_db::sql::query(
            "UPDATE api_face SET cluster_id = $2, cluster_person_id = NULL WHERE id = ANY($1)",
        )
        .bind(&ids)
        .bind(unknown)
        .execute(&mut *conn)
        .await?;
        let ids: Vec<i32> = known.iter().map(|f| f.id).collect();
        lp_db::sql::query("UPDATE api_face SET cluster_id = $2 WHERE id = ANY($1)")
            .bind(&ids)
            .bind(unknown)
            .execute(&mut *conn)
            .await?;
        return Ok(0);
    }

    if !known.is_empty() {
        // `_split_by_person`: one cluster per labelled person; the unlabelled
        // faces of this group keep no cluster.
        let mut per_person: Vec<PersonCluster> = Vec::new();
        let mut index: HashMap<i32, usize> = HashMap::new();
        for face in &known {
            let person = face.person_id.expect("known face");
            let slot = match index.get(&person) {
                Some(i) => *i,
                None => {
                    let name = format!("Cluster {cluster_id}-{}", per_person.len() + 1);
                    let id = cluster_by_name(conn, user_id, &name).await?;
                    per_person.push((person, id, Vec::new(), Vec::new()));
                    index.insert(person, per_person.len() - 1);
                    per_person.len() - 1
                }
            };
            per_person[slot].2.push(face.id);
            per_person[slot].3.push(decode(face.id, &face.encoding)?);
        }
        for (person, id, face_ids, encodings) in &per_person {
            lp_db::sql::query("UPDATE api_face SET cluster_id = $2 WHERE id = ANY($1)")
                .bind(face_ids)
                .bind(id)
                .execute(&mut *conn)
                .await?;
            lp_db::sql::query(
                "UPDATE api_cluster SET cluster_id = $2, person_id = $3, mean_face_encoding = $4 \
                 WHERE id = $1",
            )
            .bind(id)
            .bind(cluster_id as i32)
            .bind(person)
            .bind(FaceEncoding::encode(&mean_encoding(encodings)))
            .execute(&mut *conn)
            .await?;
        }
        return Ok(per_person.len());
    }

    // `_create_cluster_person`.
    let name = format!("Unknown {:0>pad$}", cluster_id);
    let person = cluster_person(conn, user_id, &name).await?;
    let id = cluster_by_id(conn, user_id, cluster_id as i32).await?;
    let ids: Vec<i32> = unknown_faces.iter().map(|f| f.id).collect();
    lp_db::sql::query(
        "UPDATE api_face SET cluster_id = $2, cluster_person_id = $3 WHERE id = ANY($1)",
    )
    .bind(&ids)
    .bind(id)
    .bind(person)
    .execute(&mut *conn)
    .await?;
    let encodings = unknown_faces
        .iter()
        .map(|f| decode(f.id, &f.encoding))
        .collect::<anyhow::Result<Vec<_>>>()?;
    lp_db::sql::query(
        "UPDATE api_cluster SET name = $2, person_id = $3, mean_face_encoding = $4 WHERE id = $1",
    )
    .bind(id)
    .bind(format!("Cluster {cluster_id}"))
    .bind(person)
    .bind(FaceEncoding::encode(&mean_encoding(&encodings)))
    .execute(&mut *conn)
    .await?;
    Ok(1)
}

/// `Cluster.get_or_create_cluster_by_name`.
async fn cluster_by_name(conn: &mut Conn, user_id: i32, name: &str) -> sqlx::Result<i32> {
    if let Some(id) = lp_db::sql::query_scalar(
        "SELECT id FROM api_cluster WHERE owner_id = $1 AND name = $2 ORDER BY id LIMIT 1",
    )
    .bind(user_id)
    .bind(name)
    .fetch_optional(&mut *conn)
    .await?
    {
        return Ok(id);
    }
    lp_db::sql::query_scalar(
        "INSERT INTO api_cluster (mean_face_encoding, cluster_id, name, person_id, owner_id) \
         VALUES ('', NULL, $2, NULL, $1) RETURNING id",
    )
    .bind(user_id)
    .bind(name)
    .fetch_one(&mut *conn)
    .await
}

/// `Cluster.get_or_create_cluster_by_id`.
async fn cluster_by_id(conn: &mut Conn, user_id: i32, cluster_id: i32) -> sqlx::Result<i32> {
    if let Some(id) = lp_db::sql::query_scalar(
        "SELECT id FROM api_cluster WHERE owner_id = $1 AND cluster_id = $2 ORDER BY id LIMIT 1",
    )
    .bind(user_id)
    .bind(cluster_id)
    .fetch_optional(&mut *conn)
    .await?
    {
        return Ok(id);
    }
    lp_db::sql::query_scalar(
        "INSERT INTO api_cluster (mean_face_encoding, cluster_id, name, person_id, owner_id) \
         VALUES ('', $2, NULL, NULL, $1) RETURNING id",
    )
    .bind(user_id)
    .bind(cluster_id)
    .fetch_one(&mut *conn)
    .await
}

/// `get_or_create_person(name, owner, KIND_CLUSTER)` + `cluster_owner` + `save()`.
async fn cluster_person(conn: &mut Conn, user_id: i32, name: &str) -> sqlx::Result<i32> {
    if let Some(id) = lp_db::sql::query_scalar(
        "UPDATE api_person SET last_modified = now() WHERE id = ( \
           SELECT id FROM api_person WHERE name = $1 AND cluster_owner_id = $2 AND kind = 'CLUSTER' \
           ORDER BY id LIMIT 1) RETURNING id",
    )
    .bind(name)
    .bind(user_id)
    .fetch_optional(&mut *conn)
    .await?
    {
        return Ok(id);
    }
    lp_db::sql::query_scalar(
        "INSERT INTO api_person (name, kind, cluster_owner_id, face_count, cover_face_id, \
           cover_photo_id, last_modified) VALUES ($1, 'CLUSTER', $2, 0, NULL, NULL, now()) RETURNING id",
    )
    .bind(name)
    .bind(user_id)
    .fetch_one(&mut *conn)
    .await
}

/// A failed fit is stored as the job's error with the sidecar's own text,
/// as Django's `lrj.fail(error=err)` stores `str(err)`.
fn sidecar_failure(e: SidecarError) -> anyhow::Error {
    match &e {
        SidecarError::Status { detail, .. } => anyhow::anyhow!("{detail}"),
        _ => anyhow::Error::new(e),
    }
}

#[derive(Debug, FromRow)]
struct TrainFace {
    id: i32,
    person_id: Option<i32>,
    encoding: String,
    cluster_id: Option<i32>,
}

/// `train_faces`: predict for every unlabelled face the most likely
/// person (labelled persons) and the most likely cluster person.
pub async fn train_faces(
    state: &AppState,
    user_id: i32,
    lrj_id: Option<&str>,
) -> anyhow::Result<bool> {
    let job_id = run::begin(&state.db, lrj_id, JobType::TrainFaces, user_id).await?;
    run::set_progress(&state.db, &job_id, 1, 2).await?;
    match train(state, user_id, &job_id).await {
        Ok(()) => Ok(true),
        Err(e) => {
            tracing::error!(error = %e, "face training failed");
            run::fail(&state.db, &job_id, &e.to_string()).await?;
            Ok(false)
        }
    }
}

async fn train(state: &AppState, user_id: i32, job_id: &str) -> anyhow::Result<()> {
    let faces = lp_db::sql::query_as::<_, TrainFace>(
        "SELECT f.id, f.person_id, f.encoding, f.cluster_id FROM api_face f \
         JOIN api_photo p ON p.id = f.photo_id \
         WHERE p.owner_id = $1 AND f.encoding IS NOT NULL AND f.encoding <> '' AND NOT f.deleted \
         ORDER BY f.id",
    )
    .bind(user_id)
    .fetch_all(&state.db)
    .await?;
    let clusters: Vec<(i32, String)> = lp_db::sql::query_as(
        "SELECT c.person_id, c.mean_face_encoding FROM api_cluster c \
         JOIN api_person pe ON pe.id = c.person_id \
         WHERE c.owner_id = $1 AND pe.kind = 'CLUSTER' ORDER BY c.id",
    )
    .bind(user_id)
    .fetch_all(&state.db)
    .await?;

    let mut known = Vec::new();
    let mut unknown = Vec::new();
    let mut cluster_of: HashMap<i32, Option<i32>> = HashMap::new();
    for f in faces {
        match f.person_id {
            Some(person_id) => known.push(LabelledEncoding {
                person_id,
                encoding: f.encoding,
            }),
            None => {
                cluster_of.insert(f.id, f.cluster_id);
                unknown.push(ClusterFace {
                    id: f.id,
                    encoding: f.encoding,
                });
            }
        }
    }
    let request = TrainRequest {
        known,
        clusters: clusters
            .into_iter()
            .map(|(person_id, encoding)| LabelledEncoding {
                person_id,
                encoding,
            })
            .collect(),
        unknown,
    };
    let predictions = state
        .ml()
        .face_cluster()
        .train(&request)
        .await
        .map_err(sidecar_failure)?
        .predictions;
    let target = predictions.len();
    if target == 0 {
        run::set_progress(&state.db, job_id, 2, 2).await?;
        run::complete(&state.db, job_id).await?;
        return Ok(());
    }

    let mut tx = state.db.begin().await?;
    let unknown_cluster = unknown_cluster(&mut tx, user_id).await?;
    let mut ids = Vec::with_capacity(target);
    let mut cluster_person = Vec::with_capacity(target);
    let mut cluster_probability = Vec::with_capacity(target);
    let mut apply_cluster = Vec::with_capacity(target);
    let mut classification_person = Vec::with_capacity(target);
    let mut classification_probability = Vec::with_capacity(target);
    for p in predictions {
        let in_unknown = cluster_of.get(&p.id).copied().flatten() == Some(unknown_cluster);
        ids.push(p.id);
        apply_cluster.push(!in_unknown);
        cluster_person.push(p.cluster_person_id);
        cluster_probability.push(if in_unknown {
            0.0
        } else {
            p.cluster_probability
        });
        classification_person.push(p.classification_person_id);
        classification_probability.push(if p.classification_person_id.is_some() {
            p.classification_probability
        } else {
            0.0
        });
    }
    lp_db::sql::query(
        "UPDATE api_face f SET \
           cluster_person_id = CASE WHEN u.apply THEN u.cluster_person ELSE f.cluster_person_id END, \
           cluster_probability = u.cluster_probability, \
           classification_person_id = COALESCE(u.classification_person, f.classification_person_id), \
           classification_probability = u.classification_probability \
         FROM unnest($1::int[], $2::bool[], $3::int[], $4::float8[], $5::int[], $6::float8[]) \
           AS u(id, apply, cluster_person, cluster_probability, classification_person, \
                classification_probability) \
         WHERE f.id = u.id",
    )
    .bind(&ids)
    .bind(&apply_cluster)
    .bind(&cluster_person)
    .bind(&cluster_probability)
    .bind(&classification_person)
    .bind(&classification_probability)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    let target = i32::try_from(target).unwrap_or(i32::MAX);
    run::set_progress(&state.db, job_id, target, target).await?;
    run::complete(&state.db, job_id).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn min_cluster_size() {
        assert_eq!(resolve_min_cluster_size(0, 10), 2);
        assert_eq!(resolve_min_cluster_size(1, 5000), 4);
        assert_eq!(resolve_min_cluster_size(0, 20_000), 8);
        assert_eq!(resolve_min_cluster_size(0, 200_000), 16);
        assert_eq!(resolve_min_cluster_size(7, 3), 7);
    }

    #[test]
    fn mean_is_numpy_axis0() {
        let rows = vec![vec![0.1, 1.0], vec![0.2, 2.0], vec![0.3, 4.0]];
        let m = mean_encoding(&rows);
        assert_eq!(m[0], ((0.1 + 0.2) + 0.3) / 3.0);
        assert_eq!(m[1], 7.0 / 3.0);
    }

    #[test]
    fn unknown_names_pad_like_zfill() {
        let pad = 2;
        assert_eq!(format!("Unknown {:0>pad$}", 3), "Unknown 03");
        assert_eq!(format!("Unknown {:0>pad$}", 12), "Unknown 12");
    }
}
