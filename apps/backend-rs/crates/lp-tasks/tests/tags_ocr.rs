//! tags.generate, ocr.generate, media.classify and captions.generate on a
//! fixture clone against the mock sidecars.

#![allow(clippy::disallowed_methods, clippy::type_complexity)]

mod common;

use common::*;
use lp_jobs::{EnqueueOptions, JobType};
use serde_json::{Value, json};
use uuid::Uuid;

async fn photo_id(_db: &sqlx::PgPool, key: &str) -> Uuid {
    let m = manifest();
    m["photos"][key]["id"].as_str().unwrap().parse().unwrap()
}

#[tokio::test]
async fn tags_generate_files_tags_under_thing_albums() {
    let t = TasksApp::new().await;
    t.copy_thumbnails();
    let db = t.db().clone();
    let alice = user_id(&db, "alice").await;
    let model = t.state.settings().tagging_model.clone();
    // Start from no tags of the active model.
    sqlx::query("UPDATE api_photo_caption SET captions_json = captions_json - $1")
        .bind(&model)
        .execute(&db)
        .await
        .unwrap();

    let untagged: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM api_photo p LEFT JOIN api_photo_caption c ON c.photo_id = p.id \
         WHERE p.owner_id = $1 AND (c.photo_id IS NULL OR c.captions_json IS NULL OR NOT (c.captions_json ? $2))",
    )
    .bind(alice)
    .bind(&model)
    .fetch_one(&db)
    .await
    .unwrap();
    assert!(untagged > 20);

    let (res, lrj) = run_job(
        &t.state,
        "tags.generate",
        json!({"user_id": alice, "full_scan": true}),
        EnqueueOptions::tracked(JobType::GenerateTags, alice),
    )
    .await;
    res.unwrap();
    let j = job(&db, lrj.as_deref().unwrap()).await;
    assert!(j.finished && !j.failed, "{j:?}");
    assert_eq!(j.job_type, 12);
    assert_eq!(j.progress_target as i64, untagged);
    assert_eq!(j.progress_current, j.progress_target);
    assert!(j.started_at.is_some());
    assert!(j.result.is_none(), "{:?}", j.result);

    // Every photo with a big thumbnail was tagged with the mock's labels.
    let e2e01 = photo_id(&db, "alice/e2e_01").await;
    let hash = manifest()["photos"]["alice/e2e_01"]["image_hash"]
        .as_str()
        .unwrap()
        .to_string();
    let cj: Value =
        sqlx::query_scalar("SELECT captions_json FROM api_photo_caption WHERE photo_id = $1")
            .bind(e2e01)
            .fetch_one(&db)
            .await
            .unwrap();
    let expected = mock_tags(&format!("{hash}.webp"));
    assert_eq!(cj[&model], json!({"tags": expected}));
    // Other caption keys survive.
    assert!(
        cj.get("im2txt").is_some() || cj.get("user_caption").is_some(),
        "{cj}"
    );

    // S1: thing albums hold the photo, counts over non-hidden photos, covers.
    let thing_type = format!("{model}_tag");
    let rows: Vec<(String, i32, i64, i64)> = sqlx::query_as(
        "SELECT a.title, a.photo_count, \
           (SELECT count(*) FROM api_albumthing_photos l JOIN api_photo p ON p.id = l.photo_id \
             WHERE l.albumthing_id = a.id AND NOT p.hidden), \
           (SELECT count(*) FROM api_albumthing_cover_photos c WHERE c.albumthing_id = a.id) \
         FROM api_albumthing a WHERE a.owner_id = $1 AND a.thing_type = $2",
    )
    .bind(alice)
    .bind(&thing_type)
    .fetch_all(&db)
    .await
    .unwrap();
    assert!(!rows.is_empty());
    let labels = ["beach", "sunset", "dog", "mountain", "receipt", "city"];
    for (title, count, real, covers) in rows.iter().filter(|r| labels.contains(&r.0.as_str())) {
        assert_eq!(*count as i64, *real, "{title}");
        assert_eq!(*covers, (*real).min(4), "{title}");
    }
    let member: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM api_albumthing_photos l JOIN api_albumthing a ON a.id = l.albumthing_id \
         WHERE l.photo_id = $1 AND a.title = $2 AND a.thing_type = $3)",
    )
    .bind(e2e01)
    .bind(&expected[0])
    .bind(&thing_type)
    .fetch_one(&db)
    .await
    .unwrap();
    assert!(member);

    // S19: the new tags are searchable right away.
    let search: String =
        sqlx::query_scalar("SELECT search_captions FROM api_photo_search WHERE photo_id = $1")
            .bind(e2e01)
            .fetch_one(&db)
            .await
            .unwrap();
    assert!(search.starts_with(&expected.join(" ")), "{search}");

    // The photo without a thumbnail gets an empty caption row and no tags.
    let no_thumb = photo_id(&db, "alice/no_thumbnail").await;
    let cj: Option<Value> =
        sqlx::query_scalar("SELECT captions_json FROM api_photo_caption WHERE photo_id = $1")
            .bind(no_thumb)
            .fetch_optional(&db)
            .await
            .unwrap()
            .flatten();
    assert!(cj.is_none_or(|v| v.get(&model).is_none()));

    // An incremental run right after finds nothing new.
    t.mock.clear();
    let (res, lrj) = run_job(
        &t.state,
        "tags.generate",
        json!({"user_id": alice}),
        EnqueueOptions::tracked(JobType::GenerateTags, alice),
    )
    .await;
    res.unwrap();
    let j = job(&db, lrj.as_deref().unwrap()).await;
    assert!(j.finished);
    assert!(t.mock.calls_to("/generate-tags").len() <= 1);
    t.cleanup().await;
}

#[tokio::test]
async fn tags_errors_follow_django() {
    let t = TasksApp::new().await;
    t.copy_thumbnails();
    let db = t.db().clone();
    let bob = user_id(&db, "bob").await;
    sqlx::query("DELETE FROM api_photo_caption WHERE photo_id IN (SELECT id FROM api_photo WHERE owner_id = $1)")
        .bind(bob)
        .execute(&db)
        .await
        .unwrap();

    // An error status is a skipped photo, not a job error.
    t.mock.knobs.lock().unwrap().fail =
        vec![("/generate-tags".into(), 500, json!({"error": "boom"}))];
    let (res, lrj) = run_job(
        &t.state,
        "tags.generate",
        json!({"user_id": bob, "full_scan": true}),
        EnqueueOptions::tracked(JobType::GenerateTags, bob),
    )
    .await;
    res.unwrap();
    let j = job(&db, lrj.as_deref().unwrap()).await;
    assert!(j.finished && !j.failed && j.result.is_none(), "{j:?}");

    // An unreachable sidecar is an error per photo.
    let mut state = t.state.clone();
    state.sidecars = state
        .sidecars
        .clone()
        .with_base(lp_sidecars::Sidecar::Tags, "http://127.0.0.1:9");
    let (res, lrj) = run_job(
        &state,
        "tags.generate",
        json!({"user_id": bob, "full_scan": true}),
        EnqueueOptions::tracked(JobType::GenerateTags, bob),
    )
    .await;
    res.unwrap();
    let j = job(&db, lrj.as_deref().unwrap()).await;
    assert!(j.finished, "{j:?}");
    let result = j.result.expect("errors recorded");
    assert_eq!(result["status"], "partial_failure");
    assert_eq!(
        result["error_count"].as_i64().unwrap(),
        j.progress_target as i64
    );
    assert!(
        result["error"].as_str().unwrap().contains("unreachable"),
        "{result}"
    );
    t.cleanup().await;
}

#[tokio::test]
async fn ocr_generate_stores_text_and_derives_documents() {
    let t = TasksApp::new().await;
    t.copy_thumbnails();
    let db = t.db().clone();
    let alice = user_id(&db, "alice").await;

    // OCR off: the job completes with nothing to do.
    let (res, lrj) = run_job(
        &t.state,
        "ocr.generate",
        json!({"user_id": alice, "full_scan": false}),
        EnqueueOptions::tracked(JobType::GenerateOcr, alice),
    )
    .await;
    res.unwrap();
    let j = job(&db, lrj.as_deref().unwrap()).await;
    assert!(j.finished && j.progress_target == 0);
    assert!(t.mock.calls_to("/ocr").is_empty());

    lp_db::write::settings::save(&t.state, &[("OCR_MODEL", json!("pp_ocrv5_mobile"))])
        .await
        .unwrap();
    // A user-corrected photo keeps its category.
    let pinned = photo_id(&db, "alice/e2e_02").await;
    sqlx::query("UPDATE api_photo SET category_source = 'user', is_document = FALSE WHERE id = $1")
        .bind(pinned)
        .execute(&db)
        .await
        .unwrap();

    let (res, lrj) = run_job(
        &t.state,
        "ocr.generate",
        json!({"user_id": alice, "full_scan": true}),
        EnqueueOptions::tracked(JobType::GenerateOcr, alice),
    )
    .await;
    res.unwrap();
    let j = job(&db, lrj.as_deref().unwrap()).await;
    let photos: i64 =
        sqlx::query_scalar("SELECT count(*) FROM api_photo WHERE owner_id = $1 AND NOT video")
            .bind(alice)
            .fetch_one(&db)
            .await
            .unwrap();
    assert_eq!(j.progress_target as i64, photos);
    assert!(j.finished, "{j:?}");

    let rows: Vec<(Uuid, String, String, Option<i32>, bool, String, String)> = sqlx::query_as(
        "SELECT p.id, p.image_hash, o.engine, o.source_width, p.is_document, p.category_source, \
           COALESCE(o.text, '') FROM api_photo_ocr o JOIN api_photo p ON p.id = o.photo_id \
         WHERE p.owner_id = $1",
    )
    .bind(alice)
    .fetch_all(&db)
    .await
    .unwrap();
    assert!(
        rows.len() as i64 >= photos - 2,
        "{} of {photos}",
        rows.len()
    );
    let mut documents = 0;
    for (id, _hash, engine, width, is_document, source, text) in &rows {
        assert_eq!(engine, "pp_ocrv5_mobile");
        assert_eq!(*width, Some(640));
        if *id == pinned {
            assert!(!is_document);
            assert_eq!(source, "user");
        } else if text.contains("TOTAL") {
            // dense text + receipt fingerprint
            assert!(is_document, "{text}");
            documents += 1;
        }
    }
    assert!(documents > 0);

    // Incremental: everything already has this engine.
    t.mock.clear();
    let (res, lrj) = run_job(
        &t.state,
        "ocr.generate",
        json!({"user_id": alice, "full_scan": false}),
        EnqueueOptions::tracked(JobType::GenerateOcr, alice),
    )
    .await;
    res.unwrap();
    let j = job(&db, lrj.as_deref().unwrap()).await;
    assert!(j.finished);
    assert_eq!(t.mock.calls_to("/ocr").len() as i32, j.progress_target);
    assert!(j.progress_target <= 2, "{j:?}");

    // Caps (S18) and the error message of a failed call.
    let long = "x".repeat(25_000);
    let blocks: Vec<Value> = (0..600).map(|i| json!({"i": i})).collect();
    t.mock.knobs.lock().unwrap().fail = vec![(
        "/ocr".into(),
        200,
        json!({"text": long, "blocks": blocks, "image_width": 1, "image_height": 1}),
    )];
    let target = photo_id(&db, "alice/e2e_03").await;
    lp_tasks::ocr::ocr_photo(&t.state, target).await.unwrap();
    let (len, nblocks): (i32, i32) = sqlx::query_as(
        "SELECT length(text), jsonb_array_length(blocks) FROM api_photo_ocr WHERE photo_id = $1",
    )
    .bind(target)
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!((len, nblocks), (20_000, 500));
    t.mock.knobs.lock().unwrap().fail =
        vec![("/ocr".into(), 400, json!({"error": "Image not found"}))];
    let err = lp_tasks::ocr::ocr_photo(&t.state, target)
        .await
        .unwrap_err()
        .to_string();
    assert!(
        err.contains("OCR service returned status 400 for ") && err.ends_with(": Image not found"),
        "{err}"
    );
    t.cleanup().await;
}

#[tokio::test]
async fn classify_media_restores_categories() {
    let t = TasksApp::new().await;
    let db = t.db().clone();
    let alice = user_id(&db, "alice").await;
    let shot = photo_id(&db, "alice/screenshot").await;
    let png = photo_id(&db, "alice/png").await;
    let e2e = photo_id(&db, "alice/e2e_01").await;
    let before: Vec<(Uuid, bool, bool, chrono::DateTime<chrono::Utc>)> = sqlx::query_as(
        "SELECT id, is_screenshot, is_document, last_modified FROM api_photo WHERE owner_id = $1 ORDER BY id",
    )
    .bind(alice)
    .fetch_all(&db)
    .await
    .unwrap();
    // Scramble, and pin one photo as a manual correction.
    sqlx::query("UPDATE api_photo SET is_screenshot = NOT is_screenshot WHERE id = ANY($1)")
        .bind(vec![shot, e2e])
        .execute(&db)
        .await
        .unwrap();
    sqlx::query(
        "UPDATE api_photo SET category_source = 'user', is_screenshot = TRUE WHERE id = $1",
    )
    .bind(png)
    .execute(&db)
    .await
    .unwrap();

    let (res, lrj) = run_job(
        &t.state,
        "media.classify",
        json!({"user_id": alice}),
        EnqueueOptions::tracked(JobType::ClassifyMedia, alice),
    )
    .await;
    res.unwrap();
    let j = job(&db, lrj.as_deref().unwrap()).await;
    assert!(j.finished && !j.failed);
    assert_eq!(j.job_type, 17);
    assert_eq!(j.progress_current, j.progress_target);
    assert_eq!(j.progress_target as usize, before.len() - 1);

    let with_ocr: Vec<Uuid> = sqlx::query_scalar("SELECT photo_id FROM api_photo_ocr")
        .fetch_all(&db)
        .await
        .unwrap();
    let after: Vec<(Uuid, bool, bool, chrono::DateTime<chrono::Utc>)> = sqlx::query_as(
        "SELECT id, is_screenshot, is_document, last_modified FROM api_photo WHERE owner_id = $1 ORDER BY id",
    )
    .bind(alice)
    .fetch_all(&db)
    .await
    .unwrap();
    for (b, a) in before.iter().zip(&after) {
        if a.0 == png {
            assert!(a.1, "manual correction kept");
            continue;
        }
        assert_eq!(b.1, a.1, "is_screenshot of {}", a.0);
        if !with_ocr.contains(&a.0) {
            assert_eq!(b.2, a.2, "is_document of {} (no OCR row)", a.0);
        }
        // bulk_update: last_modified untouched
        assert_eq!(b.3, a.3);
    }
    t.cleanup().await;
}

#[tokio::test]
async fn captions_generate_uses_context_and_indexes() {
    let t = TasksApp::new().await;
    t.copy_thumbnails();
    let db = t.db().clone();
    // e2e_01 carries Anna's face; give it a place to be taken at.
    let photo = photo_id(&db, "alice/e2e_01").await;
    sqlx::query(
        "UPDATE api_photo_search SET search_location = 'Berlin, Deutschland' WHERE photo_id = $1",
    )
    .bind(photo)
    .execute(&db)
    .await
    .unwrap();
    let outcome = lp_tasks::captions::generate_im2txt(&t.state, photo)
        .await
        .unwrap();
    let hash = manifest()["photos"]["alice/e2e_01"]["image_hash"]
        .as_str()
        .unwrap()
        .to_string();
    let expected = format!("a photo of {hash}.webp");
    assert_eq!(
        outcome,
        lp_tasks::captions::CaptionOutcome::Generated(expected.clone())
    );
    let call = &t.mock.calls_to("/generate-caption")[0];
    let prompt = call["prompt"].as_str().unwrap();
    assert!(
        prompt.contains("The person in the photo is named Anna Müller."),
        "{prompt}"
    );
    assert!(
        prompt.contains("This photo was taken at Berlin, Deutschland."),
        "{prompt}"
    );
    assert!(
        call["image_path"]
            .as_str()
            .unwrap()
            .ends_with(&format!("{hash}.webp"))
    );

    let (cj, search): (Value, String) = sqlx::query_as(
        "SELECT c.captions_json, s.search_captions FROM api_photo_caption c \
         JOIN api_photo_search s ON s.photo_id = c.photo_id WHERE c.photo_id = $1",
    )
    .bind(photo)
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(cj["im2txt"], json!(expected));
    assert!(search.contains(&expected), "{search}");

    // As a job, and with a failing sidecar (Django answers False, logs it).
    t.mock.knobs.lock().unwrap().fail = vec![(
        "/generate-caption".into(),
        500,
        json!({"error": "no model"}),
    )];
    let alice = user_id(&db, "alice").await;
    let (res, lrj) = run_job(
        &t.state,
        "captions.generate",
        json!({"photo_id": photo}),
        EnqueueOptions::tracked(JobType::GenerateTags, alice),
    )
    .await;
    res.unwrap();
    let j = job(&db, lrj.as_deref().unwrap()).await;
    assert!(j.failed);
    let cj: Value =
        sqlx::query_scalar("SELECT captions_json FROM api_photo_caption WHERE photo_id = $1")
            .bind(photo)
            .fetch_one(&db)
            .await
            .unwrap();
    assert_eq!(cj["im2txt"], json!(expected), "unchanged on failure");
    t.cleanup().await;
}

#[tokio::test]
async fn captions_respect_feature_flag_and_model() {
    let t = TasksApp::with_env(&[("FEATURE_IMAGE_CAPTIONING", "0")]).await;
    t.copy_thumbnails();
    let db = t.db().clone();
    let photo = photo_id(&db, "alice/e2e_05").await;
    let outcome = lp_tasks::captions::generate_im2txt(&t.state, photo)
        .await
        .unwrap();
    assert!(!outcome.ok());
    assert!(t.mock.calls_to("/generate-caption").is_empty());
    let rows: i64 =
        sqlx::query_scalar("SELECT count(*) FROM api_photo_caption WHERE photo_id = $1")
            .bind(photo)
            .fetch_one(&db)
            .await
            .unwrap();
    assert_eq!(rows, 1, "the caption row exists either way");
    t.cleanup().await;
}
