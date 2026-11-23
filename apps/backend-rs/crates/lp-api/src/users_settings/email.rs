//! Outgoing email: `GET/POST /api/email-config/`, `POST /api/email-config/test/`
//! (`api/views/email_config.py`, `api/models/email_config.py`, `api/mail.py`),
//! sent with lettre instead of Django's SMTP backend.

use std::sync::OnceLock;
use std::time::Duration;

use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use lettre::message::Mailbox;
use lettre::transport::smtp::authentication::Credentials;
use lettre::{AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor};
use lp_auth::AdminUser;
use lp_core::django_crypto::DjangoCrypto;
use lp_core::extract::py_truthy;
use lp_core::{ApiError, ApiJson, ApiResult, AppState};
use lp_db::users_settings::EmailConfigRow;
use serde_json::{Map, Value, json};

use super::static_data::EMAIL_PRESETS;

fn presets() -> &'static Map<String, Value> {
    static P: OnceLock<Map<String, Value>> = OnceLock::new();
    P.get_or_init(|| serde_json::from_str(EMAIL_PRESETS).expect("bundled presets"))
}

/// `settings.DEFAULT_FROM_EMAIL`.
fn default_from_email() -> String {
    std::env::var("DEFAULT_FROM_EMAIL")
        .unwrap_or_else(|_| "LibrePhotos <no-reply@localhost>".into())
}

/// `EmailConfig` with its secret decrypted.
#[derive(Debug, Clone)]
pub struct EmailConfig {
    pub provider: String,
    pub from_email: String,
    pub host: String,
    pub port: i32,
    pub use_tls: bool,
    pub use_ssl: bool,
    pub username: String,
    pub secret: String,
}

impl Default for EmailConfig {
    fn default() -> Self {
        EmailConfig {
            provider: "disabled".into(),
            from_email: String::new(),
            host: String::new(),
            port: 587,
            use_tls: true,
            use_ssl: false,
            username: String::new(),
            secret: String::new(),
        }
    }
}

impl EmailConfig {
    fn from_row(row: EmailConfigRow, crypto: Option<&DjangoCrypto>) -> Self {
        let secret = match crypto {
            Some(c) => c.decrypt_str(&row.secret).unwrap_or_default(),
            None => String::new(),
        };
        EmailConfig {
            provider: row.provider,
            from_email: row.from_email,
            host: row.host,
            port: row.port,
            use_tls: row.use_tls,
            use_ssl: row.use_ssl,
            username: row.username,
            secret,
        }
    }

    fn preset(&self, key: &str) -> Option<&Value> {
        presets().get(&self.provider).and_then(|p| p.get(key))
    }

    pub fn effective_from_email(&self) -> String {
        if self.from_email.is_empty() {
            default_from_email()
        } else {
            self.from_email.clone()
        }
    }

    fn smtp_host(&self) -> String {
        if !self.host.is_empty() {
            return self.host.clone();
        }
        self.preset("host")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string()
    }

    fn smtp_port(&self) -> u16 {
        if self.port != 0 {
            return self.port as u16;
        }
        self.preset("port").and_then(Value::as_u64).unwrap_or(587) as u16
    }

    fn smtp_username(&self) -> String {
        if !self.username.is_empty() {
            return self.username.clone();
        }
        self.preset("default_username")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string()
    }

    pub fn is_configured(&self) -> bool {
        self.provider != "disabled"
            && !self.smtp_host().is_empty()
            && !self.effective_from_email().is_empty()
    }
}

/// `EmailConfig.load()` without the secret (cheap: no key derivation).
pub async fn load_public(state: &AppState) -> Result<EmailConfig, ApiError> {
    Ok(lp_db::users_settings::email_config(&state.db)
        .await?
        .map(|r| EmailConfig::from_row(r, None))
        .unwrap_or_default())
}

async fn load_with_secret(state: &AppState) -> Result<(EmailConfig, bool), ApiError> {
    match lp_db::users_settings::email_config(&state.db).await? {
        Some(row) => {
            let has_secret_bytes = !row.secret.is_empty();
            let key = state.config.secret_key.clone();
            let cfg = state
                .blocking(move || {
                    let crypto = DjangoCrypto::new(&key);
                    EmailConfig::from_row(row, Some(&crypto))
                })
                .await?;
            Ok((cfg, has_secret_bytes))
        }
        None => Ok((EmailConfig::default(), false)),
    }
}

/// `email_is_configured()` for `/api/sitesettings`.
pub async fn email_is_configured(state: &AppState) -> bool {
    load_public(state)
        .await
        .map(|c| c.is_configured())
        .unwrap_or(false)
}

fn serialize(c: &EmailConfig) -> Value {
    json!({
        "provider": c.provider,
        "from_email": c.from_email,
        "host": c.host,
        "port": c.port,
        "use_tls": c.use_tls,
        "use_ssl": c.use_ssl,
        "username": c.username,
        "has_secret": !c.secret.is_empty(),
        "is_configured": c.is_configured(),
        "presets": presets(),
    })
}

pub async fn get_config(
    State(state): State<AppState>,
    AdminUser(_admin): AdminUser,
) -> ApiResult<Response> {
    let (cfg, _) = load_with_secret(&state).await?;
    Ok(Json(serialize(&cfg)).into_response())
}

/// Django model-field coercion of a posted value for a CharField.
fn char_value(field: &str, v: &Value) -> Result<String, ApiError> {
    match v {
        Value::String(s) => Ok(s.clone()),
        Value::Number(n) => Ok(n.to_string()),
        Value::Bool(b) => Ok(if *b { "True" } else { "False" }.into()),
        _ => Err(ApiError::bad_request(field, "Not a valid string.")),
    }
}

fn bool_value(field: &str, v: &Value) -> Result<bool, ApiError> {
    match v {
        Value::Bool(b) => Ok(*b),
        Value::Number(n) if n.as_f64() == Some(1.0) => Ok(true),
        Value::Number(n) if n.as_f64() == Some(0.0) => Ok(false),
        Value::String(s) => match s.as_str() {
            "t" | "True" | "true" | "1" => Ok(true),
            "f" | "False" | "false" | "0" => Ok(false),
            _ => Err(ApiError::bad_request(field, "Must be a valid boolean.")),
        },
        _ => Err(ApiError::bad_request(field, "Must be a valid boolean.")),
    }
}

pub async fn post_config(
    State(state): State<AppState>,
    AdminUser(_admin): AdminUser,
    ApiJson(data): ApiJson<Value>,
) -> ApiResult<Response> {
    let data = data.as_object().cloned().unwrap_or_default();
    let (mut cfg, _) = load_with_secret(&state).await?;
    for (field, v) in &data {
        match field.as_str() {
            "provider" => cfg.provider = char_value(field, v)?,
            "from_email" => cfg.from_email = char_value(field, v)?,
            "host" => cfg.host = char_value(field, v)?,
            "username" => cfg.username = char_value(field, v)?,
            "use_tls" => cfg.use_tls = bool_value(field, v)?,
            "use_ssl" => cfg.use_ssl = bool_value(field, v)?,
            "port" => {
                let port = match v {
                    Value::Number(n) => n.as_i64(),
                    Value::String(s) => s.trim().parse::<i64>().ok(),
                    _ => None,
                };
                cfg.port = match port {
                    Some(p) if (0..=i32::MAX as i64).contains(&p) => p as i32,
                    _ => {
                        return Err(ApiError::bad_request(
                            "port",
                            "A valid integer is required.",
                        ));
                    }
                };
            }
            _ => {}
        }
    }
    if data.get("clear_secret").is_some_and(py_truthy) {
        cfg.secret.clear();
    } else if let Some(s) = data.get("secret").filter(|s| py_truthy(s)) {
        cfg.secret = char_value("secret", s)?;
    }
    let key = state.config.secret_key.clone();
    let plain = cfg.secret.clone();
    let token = state
        .blocking(move || DjangoCrypto::new(&key).encrypt_str(&plain))
        .await?;
    lp_db::write::users_settings::save_email_config(
        &state.db,
        &lp_db::write::users_settings::EmailConfigWrite {
            provider: &cfg.provider,
            from_email: &cfg.from_email,
            host: &cfg.host,
            port: cfg.port,
            use_tls: cfg.use_tls,
            use_ssl: cfg.use_ssl,
            username: &cfg.username,
            secret: &token,
        },
    )
    .await?;
    Ok(Json(serialize(&cfg)).into_response())
}

/// Send one plain-text message through the stored configuration.
pub async fn send_mail(
    cfg: &EmailConfig,
    subject: &str,
    body: &str,
    to: &str,
) -> Result<(), String> {
    let from: Mailbox = cfg
        .effective_from_email()
        .parse()
        .map_err(|e| format!("Invalid from address: {e}"))?;
    let to: Mailbox = to.parse().map_err(|e| format!("Invalid recipient: {e}"))?;
    let msg = Message::builder()
        .from(from)
        .to(to)
        .subject(subject)
        .body(body.to_string())
        .map_err(|e| e.to_string())?;
    let host = cfg.smtp_host();
    let builder = if cfg.use_ssl {
        AsyncSmtpTransport::<Tokio1Executor>::relay(&host).map_err(|e| e.to_string())?
    } else if cfg.use_tls {
        AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&host).map_err(|e| e.to_string())?
    } else {
        AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(&host)
    };
    let mut builder = builder
        .port(cfg.smtp_port())
        .timeout(Some(Duration::from_secs(30)));
    let user = cfg.smtp_username();
    if !user.is_empty() && !cfg.secret.is_empty() {
        builder = builder.credentials(Credentials::new(user, cfg.secret.clone()));
    }
    builder
        .build()
        .send(msg)
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Load the configuration for sending, if email is configured.
pub async fn sending_config(state: &AppState) -> Result<Option<EmailConfig>, ApiError> {
    let (cfg, _) = load_with_secret(state).await?;
    Ok(cfg.is_configured().then_some(cfg))
}

pub async fn test_email(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    ApiJson(data): ApiJson<Value>,
) -> ApiResult<Response> {
    let Some(cfg) = sending_config(&state).await? else {
        return Ok((
            StatusCode::BAD_REQUEST,
            Json(json!({"status": false, "message": "Email is not configured."})),
        )
            .into_response());
    };
    let to = data
        .get("to")
        .filter(|v| py_truthy(v))
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| admin.email.clone());
    let recipient = to.trim().to_string();
    if recipient.is_empty() {
        return Ok((
            StatusCode::BAD_REQUEST,
            Json(json!({
                "status": false,
                "message": "No recipient address; set an email on your account or provide one."
            })),
        )
            .into_response());
    }
    let result = send_mail(
        &cfg,
        "LibrePhotos test email",
        "This is a test message from LibrePhotos. If you received it, your email \
         configuration is working.",
        &recipient,
    )
    .await;
    Ok(Json(match result {
        Ok(()) => json!({"status": true, "message": format!("Test email sent to {recipient}.")}),
        Err(e) => {
            tracing::error!(error = %e, "Test email failed");
            json!({"status": false, "message": e})
        }
    })
    .into_response())
}
