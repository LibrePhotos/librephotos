//! Library roots: `normalize_scan_directory`, the overlap rule (#2034) and
//! `auto_create_user_directory` from `api/serializers/user.py`.

use lp_core::{ApiError, AppState};
use lp_db::users::User;

use super::pypath;

fn data_root(state: &AppState) -> String {
    state.config.photos.to_string_lossy().into_owned()
}

/// `reject_overlap_with_another_user`; `user` is the account being edited.
async fn reject_overlap(
    state: &AppState,
    abs_dir: &str,
    user: Option<&User>,
) -> Result<(), ApiError> {
    if let Some(u) = user
        && !u.scan_directory.is_empty()
        && pypath::comparable(abs_dir) == pypath::comparable(&u.scan_directory)
    {
        return Ok(());
    }
    let others =
        lp_db::users_settings::other_scan_directories(&state.db, user.map(|u| u.id)).await?;
    let dir = abs_dir.to_string();
    let conflict = state
        .blocking(move || {
            others
                .into_iter()
                .find(|o| pypath::overlap(&dir, &o.scan_directory))
        })
        .await?;
    if let Some(other) = conflict {
        return Err(ApiError::validation(format!(
            "Scan directory overlaps the library of user '{}' ({}). Every photo has \
             exactly one owner, so two users cannot scan the same files.",
            other.username, other.scan_directory
        )));
    }
    Ok(())
}

/// `normalize_scan_directory`: None when nothing was supplied.
pub async fn normalize(
    state: &AppState,
    scan_directory: &str,
    user: Option<&User>,
) -> Result<Option<String>, ApiError> {
    if scan_directory.is_empty() {
        return Ok(None);
    }
    let abs = pypath::abspath(scan_directory);
    if !pypath::is_valid_path(&abs, &data_root(state)) {
        return Err(ApiError::validation(
            "Scan directory must be inside the data root.",
        ));
    }
    if !std::path::Path::new(&abs).exists() {
        return Err(ApiError::validation("Scan directory does not exist"));
    }
    reject_overlap(state, &abs, user).await?;
    Ok(Some(abs))
}

/// `auto_create_user_directory`: never fails the caller, refusals are logged.
pub async fn auto_create(state: &AppState, user: &User, claim_existing: bool) {
    if !state.settings().auto_create_user_directory || !user.scan_directory.is_empty() {
        return;
    }
    let refuse = |reason: String| {
        tracing::warn!(
            "Not creating a data folder for user {}: {reason}. The account was created \
             without a scan directory; assign one in the Admin Area.",
            user.username
        );
    };
    let root = pypath::abspath(&data_root(state));
    let candidate = pypath::abspath(&pypath::join(&root, &user.username));
    if pypath::dirname(&candidate) != root {
        refuse(format!(
            "the username does not name a folder directly inside {root}"
        ));
        return;
    }
    if let Err(e) = reject_overlap(state, &candidate, Some(user)).await {
        refuse(format!(
            "{candidate} is not available. {}",
            e.first_message().unwrap_or_default()
        ));
        return;
    }
    let path = std::path::Path::new(&candidate);
    if std::fs::symlink_metadata(path).is_ok() {
        if !claim_existing {
            refuse(format!(
                "{candidate} already exists and may hold someone else's photos, so it is \
                 not handed to a self-registered or single sign-on account"
            ));
            return;
        }
        if !path.is_dir() {
            refuse(format!("{candidate} exists but is not a directory"));
            return;
        }
    } else {
        match std::fs::create_dir_all(pypath::dirname(&candidate))
            .and_then(|_| std::fs::create_dir(path))
        {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists && claim_existing => {}
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                refuse(format!(
                    "{candidate} was created by something else meanwhile"
                ));
                return;
            }
            Err(e) => {
                refuse(format!("could not create {candidate}: {e}"));
                return;
            }
        }
    }
    if let Err(e) =
        lp_db::write::users_settings::set_scan_directory(&state.db, user.id, &candidate).await
    {
        tracing::error!(error = %e, "could not store the new scan directory");
        return;
    }
    tracing::info!("Assigned data folder {candidate} to user {}", user.username);
}
