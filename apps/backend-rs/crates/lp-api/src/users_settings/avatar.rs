//! `User.avatar` (`ImageField(upload_to="avatars")`): DRF's file checks,
//! Django's image check, and `FileSystemStorage.save` naming.

use std::sync::OnceLock;

use lp_core::{ApiError, AppState};
use rand::Rng;
use regex::Regex;
use serde_json::Value;

use super::input::{InputValue, UploadedFile};

const MAX_NAME: usize = 100;

/// Ok(None) clears the avatar (`null`), Ok(Some) is an upload, Err a DRF message.
pub fn validate(raw: &InputValue) -> Result<Option<UploadedFile>, String> {
    let file = match raw {
        InputValue::Value(Value::Null) => return Ok(None),
        InputValue::Value(_) => {
            return Err(
                "The submitted data was not a file. Check the encoding type on the form.".into(),
            );
        }
        InputValue::File(f) => f,
    };
    if file.filename.is_empty() {
        return Err("No filename could be determined.".into());
    }
    if file.bytes.is_empty() {
        return Err("The submitted file is empty.".into());
    }
    let len = file.filename.chars().count();
    if len > MAX_NAME {
        return Err(format!(
            "Ensure this filename has at most {MAX_NAME} characters (it has {len})."
        ));
    }
    if image::load_from_memory(&file.bytes).is_err() {
        return Err(
            "Upload a valid image. The file you uploaded was either not an image or a corrupted image."
                .into(),
        );
    }
    Ok(Some(file.clone()))
}

/// `django.utils.text.get_valid_filename`.
fn valid_filename(name: &str) -> Option<String> {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r"[^-\w.]").expect("regex"));
    let base = name.rsplit(['/', '\\']).next().unwrap_or(name);
    let s = base.trim().replace(' ', "_");
    let s = re.replace_all(&s, "").into_owned();
    if s.is_empty() || s == "." || s == ".." {
        None
    } else {
        Some(s)
    }
}

fn random_suffix() -> String {
    const CHARS: &[u8] = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let mut rng = rand::thread_rng();
    (0..7)
        .map(|_| CHARS[rng.gen_range(0..CHARS.len())] as char)
        .collect()
}

/// Save under `MEDIA_ROOT/avatars/`, returning the stored name (`avatars/x.png`).
pub async fn store(state: &AppState, file: &UploadedFile) -> Result<String, ApiError> {
    let name = valid_filename(&file.filename).ok_or_else(|| {
        ApiError::bad_request("avatar", "Could not derive file name from the upload.")
    })?;
    let dir = state.config.avatars_dir();
    tokio::fs::create_dir_all(&dir).await?;
    let (root, ext) = match name.rfind('.') {
        Some(i) if i > 0 => (name[..i].to_string(), name[i..].to_string()),
        _ => (name.clone(), String::new()),
    };
    let mut candidate = name.clone();
    loop {
        let path = dir.join(&candidate);
        match tokio::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .await
        {
            Ok(mut f) => {
                use tokio::io::AsyncWriteExt;
                f.write_all(&file.bytes).await?;
                f.flush().await?;
                return Ok(format!("avatars/{candidate}"));
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                candidate = format!("{root}_{}{ext}", random_suffix());
            }
            Err(e) => return Err(e.into()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filenames() {
        assert_eq!(
            valid_filename("Alice avatar.png").as_deref(),
            Some("Alice_avatar.png")
        );
        assert_eq!(valid_filename("../x?.png").as_deref(), Some("x.png"));
        assert_eq!(valid_filename(".."), None);
    }
}
