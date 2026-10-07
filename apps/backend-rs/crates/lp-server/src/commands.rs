//! Ports of the `manage.py` commands people run against a LibrePhotos
//! install (`apps/backend-rs/CLI.md` lists them, and the ones left out).
//! Each takes the state and the two output streams, so tests drive them
//! like the binary does.

use std::io::Write;

use chrono::{Duration, Utc};
use lp_core::AppState;
use lp_core::django_crypto::DjangoCrypto;
use lp_ingest::metadata_backfill::{self, FaceFilter};
use lp_jobs::{EnqueueOptions, JobType};
use serde_json::json;

/// `chunked_upload.settings.EXPIRATION_DELTA` (`DEFAULT_EXPIRATION_DELTA`).
pub const UPLOAD_EXPIRATION: Duration = Duration::days(1);

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ScanMode {
    /// Default / `-f`: the whole scan directory of every user.
    Directory { full_scan: bool },
    /// `-s FILE..`: only these files, each for the users whose scan
    /// directory is a string prefix of it.
    Files(Vec<String>),
    /// `-n`: every user's Nextcloud scan directory.
    Nextcloud,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QueuedScan {
    pub user_id: i32,
    pub username: String,
    pub kind: &'static str,
    pub lrj_id: Option<String>,
    pub files: Vec<String>,
}

struct UserRow {
    id: i32,
    username: String,
    scan_directory: String,
    nextcloud_scan_directory: String,
}

async fn users(state: &AppState) -> sqlx::Result<Vec<UserRow>> {
    let rows: Vec<(i32, String, String, String)> = lp_db::sql::query_as(
        "SELECT id, username, scan_directory, nextcloud_scan_directory FROM api_user ORDER BY id",
    )
    .fetch_all(&state.db)
    .await?;
    Ok(rows
        .into_iter()
        .map(
            |(id, username, scan_directory, nextcloud_scan_directory)| UserRow {
                id,
                username,
                scan_directory,
                nextcloud_scan_directory,
            },
        )
        .collect())
}

/// `manage.py scan`: queue a `scan.user` (or `nextcloud.scan`) job per user
/// for the worker, as Django's command queues its scan work for the
/// qcluster. Directory and file scans skip the `deleted` user (created if
/// missing, like `get_deleted_user()`); the Nextcloud scan goes through
/// every user with a Nextcloud scan directory.
pub async fn scan(
    state: &AppState,
    mode: &ScanMode,
    out: &mut dyn Write,
) -> anyhow::Result<Vec<QueuedScan>> {
    let deleted_id = {
        let mut conn = state.db.acquire().await?;
        let crypto = DjangoCrypto::new(&state.config.secret_key);
        lp_db::write::users_settings::deleted_user_id(&mut conn, &crypto).await?
    };
    let mut queued = Vec::new();
    for user in users(state).await? {
        let (kind, payload, files) = match mode {
            ScanMode::Nextcloud => {
                if user.nextcloud_scan_directory.is_empty() {
                    writeln!(
                        out,
                        "Skipping nextcloud scan for user {}. No scan directory configured.",
                        user.username
                    )?;
                    continue;
                }
                writeln!(out, "Starting nextcloud scan for user {}.", user.username)?;
                (
                    lp_tasks::nextcloud::KIND,
                    json!({"user_id": user.id}),
                    Vec::new(),
                )
            }
            _ if user.id == deleted_id => continue,
            ScanMode::Directory { full_scan } => (
                "scan.user",
                json!({"user_id": user.id, "full_scan": full_scan, "scan_missing": false,
                       "uploaded_only": false}),
                Vec::new(),
            ),
            ScanMode::Files(all) => {
                let mine: Vec<String> = all
                    .iter()
                    .filter(|f| f.starts_with(&user.scan_directory))
                    .cloned()
                    .collect();
                if mine.is_empty() {
                    continue;
                }
                (
                    "scan.user",
                    json!({"user_id": user.id, "full_scan": false, "scan_missing": false,
                           "uploaded_only": false, "files": mine}),
                    mine,
                )
            }
        };
        if kind == "scan.user" {
            lp_tasks::models::queue_if_missing(state, user.id).await;
        }
        let e = lp_jobs::enqueue(
            state,
            kind,
            payload,
            EnqueueOptions::tracked(JobType::ScanPhotos, user.id),
        )
        .await?;
        queued.push(QueuedScan {
            user_id: user.id,
            username: user.username,
            kind,
            lrj_id: e.lrj_id,
            files,
        });
    }
    for q in &queued {
        if q.kind == "scan.user" {
            writeln!(
                out,
                "Queued scan for user {} (job {})",
                q.username,
                q.lrj_id.as_deref().unwrap_or("-")
            )?;
        }
    }
    Ok(queued)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SaveMetadataArgs {
    pub types: Vec<String>,
    pub user: Option<String>,
    pub media_file: bool,
    pub dry_run: bool,
}

/// `manage.py save_metadata`. Ok(None) when `--user` names nobody (Django
/// writes the error and returns without a failure exit).
pub async fn save_metadata(
    state: &AppState,
    args: &SaveMetadataArgs,
    out: &mut dyn Write,
    err: &mut dyn Write,
) -> anyhow::Result<Option<metadata_backfill::Outcome>> {
    let owner = match &args.user {
        None => None,
        Some(name) => match lp_db::users::by_username(&state.db, name).await? {
            Some(u) => Some(u.id),
            None => {
                writeln!(err, "User '{name}' not found")?;
                return Ok(None);
            }
        },
    };
    let ids =
        metadata_backfill::select_photos(state, owner, &args.types, FaceFilter::AnyFace).await?;
    let total = ids.len();
    let types = format!(
        "[{}]",
        args.types
            .iter()
            .map(|t| format!("'{t}'"))
            .collect::<Vec<_>>()
            .join(", ")
    );
    writeln!(out, "Found {total} photos to process (types: {types})")?;
    if args.dry_run {
        writeln!(out, "Dry run — no files will be modified")?;
        return Ok(Some(metadata_backfill::Outcome::default()));
    }
    let mut errors_text = Vec::new();
    let mut progress_text = Vec::new();
    let outcome = metadata_backfill::write_all(
        state,
        &ids,
        &args.types,
        !args.media_file,
        |hash, e| errors_text.push(format!("Error writing {hash}: {e:#}")),
        |i, o| {
            progress_text.push(format!(
                "Progress: {i}/{total} ({} written, {} errors)",
                o.written, o.errors
            ))
        },
    )
    .await;
    for line in errors_text {
        writeln!(err, "{line}")?;
    }
    for line in progress_text {
        writeln!(out, "{line}")?;
    }
    writeln!(
        out,
        "Done. {} written, {} errors out of {total} photos.",
        outcome.written, outcome.errors
    )?;
    Ok(Some(outcome))
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct ExpiredUploads {
    pub complete: usize,
    pub incomplete: usize,
}

/// `manage.py delete_expired_uploads`: every chunked upload created more
/// than a day ago, row and staged file. `confirm` (`--interactive`) is asked
/// per upload with its `__str__`.
pub async fn delete_expired_uploads(
    state: &AppState,
    mut confirm: Option<&mut dyn FnMut(&str) -> bool>,
    out: &mut dyn Write,
) -> anyhow::Result<ExpiredUploads> {
    let cutoff = Utc::now() - UPLOAD_EXPIRATION;
    let rows = lp_db::upload::created_before(&state.db, cutoff).await?;
    let mut count = ExpiredUploads::default();
    for u in rows {
        if let Some(ask) = confirm.as_mut() {
            let label = format!(
                "<{} - upload_id: {} - bytes: {} - status: {}>",
                u.filename, u.upload_id, u.offset, u.status
            );
            if !ask(&label) {
                continue;
            }
        }
        if u.status == lp_db::upload::COMPLETE {
            count.complete += 1;
        } else {
            count.incomplete += 1;
        }
        lp_db::write::upload::delete_chunked_upload(&state.db, u.id).await?;
        if !u.file.is_empty() {
            let path = state.config.media_root.join(&u.file);
            match tokio::fs::remove_file(&path).await {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => return Err(anyhow::anyhow!("{}: {e}", path.display())),
            }
        }
    }
    writeln!(out, "{} complete uploads were deleted.", count.complete)?;
    writeln!(out, "{} incomplete uploads were deleted.", count.incomplete)?;
    Ok(count)
}

/// `manage.py strip_thumbnail_metadata [--dry-run]`. Err when thumbnails
/// still carry metadata afterwards (Django's `CommandError`).
pub async fn strip_thumbnail_metadata(
    state: &AppState,
    dry_run: bool,
    out: &mut dyn Write,
    err: &mut dyn Write,
) -> anyhow::Result<lp_ingest::thumbnail_metadata::StripResult> {
    let media_root = state.config.media_root.clone();
    let exiftool = state.config.binaries.exiftool.clone();
    let (result, progress) = tokio::task::spawn_blocking(move || {
        let mut lines = Vec::new();
        let r = lp_ingest::thumbnail_metadata::strip_thumbnail_metadata(
            &media_root,
            &exiftool,
            dry_run,
            &mut |l| lines.push(l),
        );
        (r, lines)
    })
    .await?;
    for line in progress {
        writeln!(out, "{line}")?;
    }
    writeln!(
        out,
        "Scanned {} thumbnails, {} carried metadata.",
        result.scanned,
        result.with_metadata.len()
    )?;
    for e in &result.errors {
        writeln!(err, "{e}")?;
    }
    if dry_run {
        return Ok(result);
    }
    for path in &result.still_with_metadata {
        writeln!(err, "Could not strip {}", path.display())?;
    }
    let summary = format!("Stripped {} thumbnails.", result.stripped);
    if !result.still_with_metadata.is_empty() {
        anyhow::bail!(
            "{summary} {} still carry metadata.",
            result.still_with_metadata.len()
        );
    }
    writeln!(out, "{summary}")?;
    Ok(result)
}

/// `manage.py clear_cache`. Django's cache is the per-process `LocMemCache`
/// (no `CACHES` setting), so its command never reached a running server
/// either; the Rust server keeps no cache outside its own memory. Nothing to
/// clear: same message, same exit.
pub fn clear_cache(out: &mut dyn Write) -> std::io::Result<()> {
    writeln!(out, "Your cache has been cleared!")
}

/// `manage.py build_similarity_index`: queue `similarity.build` for every
/// user (Django `AsyncTask(build_image_similarity_index, user).run()`).
/// `serve` also rebuilds stale indices at startup.
pub async fn build_similarity_index(
    state: &AppState,
    out: &mut dyn Write,
) -> anyhow::Result<usize> {
    let users = users(state).await?;
    for u in &users {
        lp_jobs::enqueue(
            state,
            "similarity.build",
            json!({"user_id": u.id}),
            EnqueueOptions::default(),
        )
        .await?;
    }
    writeln!(
        out,
        "Queued similarity index builds for {} users",
        users.len()
    )?;
    Ok(users.len())
}

/// Read a yes/no answer like Django's prompt loop.
pub fn ask_yes_no(prompt: &str) -> bool {
    let stdin = std::io::stdin();
    loop {
        print!("Do you want to delete {prompt}? (y/n): ");
        let _ = std::io::stdout().flush();
        let mut line = String::new();
        if stdin.read_line(&mut line).unwrap_or(0) == 0 {
            return false;
        }
        match line.trim().to_lowercase().as_str() {
            "y" => return true,
            "n" => return false,
            _ => {}
        }
    }
}
