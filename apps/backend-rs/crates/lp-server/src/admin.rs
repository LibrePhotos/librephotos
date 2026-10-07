//! `librephotos-rs createadmin` / `createuser` (ports of `manage.py
//! createadmin` and `manage.py createuser`).

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
    if password.as_deref() == Some("") {
        anyhow::bail!("Admin password cannot be empty");
    }
    create_or_update(state, username, email, password, update, true).await
}

/// `manage.py createuser USERNAME EMAIL [--password] [--update] [--admin]`:
/// with `--admin`, `ADMIN_PASSWORD` (when set) wins over `--password`; an
/// empty or missing password is generated.
pub async fn createuser(
    state: &AppState,
    username: &str,
    email: &str,
    password: Option<String>,
    update: bool,
    admin: bool,
) -> anyhow::Result<Outcome> {
    let password = match std::env::var("ADMIN_PASSWORD") {
        Ok(p) if admin => Some(p),
        _ => password,
    };
    create_or_update(
        state,
        username,
        email,
        password.filter(|p| !p.is_empty()),
        update,
        admin,
    )
    .await
}

fn generated_password() -> String {
    const CHARS: &[u8] = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let mut rng = rand::thread_rng();
    (0..32)
        .map(|_| CHARS[rng.gen_range(0..CHARS.len())] as char)
        .collect()
}

/// Django's `validate_email`, reduced to what a command line needs: one
/// `@` with a non-empty local part and a dotted domain, no whitespace.
pub fn valid_email(email: &str) -> bool {
    let Some((local, domain)) = email.rsplit_once('@') else {
        return false;
    };
    !local.is_empty()
        && !email.chars().any(char::is_whitespace)
        && (domain == "localhost"
            || (domain.contains('.')
                && !domain.starts_with('.')
                && !domain.ends_with('.')
                && !domain.contains("..")))
}

async fn create_or_update(
    state: &AppState,
    username: &str,
    email: &str,
    password: Option<String>,
    update: bool,
    admin: bool,
) -> anyhow::Result<Outcome> {
    let username = username.to_lowercase();
    if !valid_email(email) {
        anyhow::bail!("Enter a valid email address.");
    }
    let (password, generated) = match password {
        Some(p) => (p, None),
        None => {
            let p = generated_password();
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
                    is_superuser: admin,
                    is_staff: admin,
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
            eprintln!("Warning: ignoring provided email {email}");
            lp_db::write::users::set_password(&state.db, existing.id, &hash).await?;
            Ok(Outcome::Updated { id: existing.id })
        }
        Some(_) => anyhow::bail!("Specified user already exists"),
    }
}
