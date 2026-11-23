//! `librephotos-rs createadmin` (port of `manage.py createadmin`).

use lp_core::AppState;
use lp_core::django_crypto::DjangoCrypto;
use lp_db::write::users::NewUser;
use rand::Rng;

pub enum Outcome {
    Created {
        id: i32,
        generated_password: Option<String>,
    },
    Updated {
        id: i32,
    },
}

/// Create a superuser (username lower-cased). With `update`, an existing
/// user gets the new password instead of an error.
pub async fn createadmin(
    state: &AppState,
    username: &str,
    email: &str,
    password: Option<String>,
    update: bool,
) -> anyhow::Result<Outcome> {
    let username = username.to_lowercase();
    if !email.contains('@') {
        anyhow::bail!("Enter a valid email address.");
    }
    let (password, generated) = match password {
        Some(p) if p.is_empty() => anyhow::bail!("Admin password cannot be empty"),
        Some(p) => (p, None),
        None => {
            const CHARS: &[u8] = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
            let mut rng = rand::thread_rng();
            let p: String = (0..32)
                .map(|_| CHARS[rng.gen_range(0..CHARS.len())] as char)
                .collect();
            (p.clone(), Some(p))
        }
    };
    let hash = state
        .blocking(move || lp_auth::password::hash(&password))
        .await
        .map_err(|e| anyhow::anyhow!("{e}"))?;
    match lp_db::users::by_username(&state.db, &username).await? {
        None => {
            let crypto = DjangoCrypto::new(&state.config.secret_key);
            let id = lp_db::write::users::create_user(
                &state.db,
                &crypto,
                &NewUser {
                    username: &username,
                    email,
                    password_hash: &hash,
                    first_name: "",
                    last_name: "",
                    is_superuser: true,
                    is_staff: true,
                    scan_directory: "",
                },
            )
            .await?;
            Ok(Outcome::Created {
                id,
                generated_password: generated,
            })
        }
        Some(existing) if update => {
            lp_db::write::users::set_password(&state.db, existing.id, &hash).await?;
            Ok(Outcome::Updated { id: existing.id })
        }
        Some(_) => anyhow::bail!("Specified user already exists"),
    }
}
