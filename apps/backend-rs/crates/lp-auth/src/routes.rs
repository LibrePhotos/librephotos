//! `POST /api/auth/token/{obtain,refresh,blacklist}` (03 §2).

use axum::extract::State;
use axum::http::header::{ACCESS_CONTROL_ALLOW_CREDENTIALS, SET_COOKIE};
use axum::http::{HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use lp_core::{ApiError, ApiJson, ApiResult, AppState, FieldError};
use lp_db::users;
use serde::Deserialize;
use serde_json::{Value, json};

use crate::extract::jwt_cookie_header;
use crate::jwt::{self, REFRESH, TokenError};
use crate::password;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/auth/token/obtain", post(obtain))
        .route("/api/auth/token/refresh", post(refresh))
        .route("/api/auth/token/blacklist", post(blacklist))
}

#[derive(Deserialize)]
struct ObtainBody {
    username: Option<Value>,
    password: Option<Value>,
}

#[derive(Deserialize)]
struct RefreshBody {
    refresh: Option<Value>,
}

/// DRF `CharField` validation: required, string, not blank.
fn required_str(field: &str, v: &Option<Value>) -> Result<String, FieldError> {
    let err = |m: &str| FieldError {
        field: field.into(),
        message: m.into(),
    };
    match v {
        None | Some(Value::Null) => Err(err(if v.is_none() {
            "This field is required."
        } else {
            "This field may not be null."
        })),
        Some(Value::String(s)) if s.trim().is_empty() => Err(err("This field may not be blank.")),
        Some(Value::String(s)) => Ok(s.clone()),
        Some(Value::Number(n)) => Ok(n.to_string()),
        Some(Value::Bool(b)) => Ok(if *b { "True" } else { "False" }.to_string()),
        Some(_) => Err(err("Not a valid string.")),
    }
}

fn validate(fields: Vec<Result<String, FieldError>>) -> ApiResult<Vec<String>> {
    let mut errors = Vec::new();
    let mut ok = Vec::new();
    for f in fields {
        match f {
            Ok(v) => ok.push(v),
            Err(e) => errors.push(e),
        }
    }
    if errors.is_empty() {
        Ok(ok)
    } else {
        Err(ApiError::fields(StatusCode::BAD_REQUEST, errors))
    }
}

fn token_error(e: TokenError) -> ApiError {
    let mut err = ApiError::unauthorized(e.message());
    err.errors.push(FieldError {
        field: "code".into(),
        message: "token_not_valid".into(),
    });
    err
}

fn with_jwt_cookie(body: Value, access: &str) -> Response {
    let mut resp = (StatusCode::OK, Json(body)).into_response();
    resp.headers_mut()
        .insert(SET_COOKIE, jwt_cookie_header(access));
    resp.headers_mut().insert(
        ACCESS_CONTROL_ALLOW_CREDENTIALS,
        HeaderValue::from_static("true"),
    );
    resp
}

async fn obtain(
    State(state): State<AppState>,
    ApiJson(body): ApiJson<ObtainBody>,
) -> ApiResult<Response> {
    let v = validate(vec![
        required_str("username", &body.username),
        required_str("password", &body.password),
    ])?;
    let (username, pw) = (v[0].clone(), v[1].clone());
    let no_account =
        || ApiError::unauthorized("No active account found with the given credentials");

    let user = users::by_username(&state.db, &username).await?;
    let Some(user) = user else {
        return Err(no_account());
    };
    let encoded = user.password.clone();
    let ok = state
        .blocking(move || password::verify(&pw, &encoded))
        .await?;
    if !ok || !user.is_active {
        return Err(no_account());
    }
    let pair = jwt::issue_pair(
        &state.jwt,
        &state.config,
        &user,
        state.settings().nextcloud_enabled,
    );
    lp_db::write::auth::record_refresh(
        &state.db,
        &pair.refresh_claims.jti,
        user.id,
        ts(pair.refresh_claims.exp),
    )
    .await?;
    Ok(with_jwt_cookie(
        json!({"refresh": pair.refresh, "access": pair.access}),
        &pair.access,
    ))
}

fn ts(secs: i64) -> DateTime<Utc> {
    DateTime::from_timestamp(secs, 0).unwrap_or_else(Utc::now)
}

async fn refresh(
    State(state): State<AppState>,
    ApiJson(body): ApiJson<RefreshBody>,
) -> ApiResult<Response> {
    let v = validate(vec![required_str("refresh", &body.refresh)])?;
    let claims = jwt::decode(&state.jwt, &v[0], REFRESH).map_err(token_error)?;
    if users::refresh_revoked(&state.db, &claims.jti).await? {
        return Err(token_error_msg("Token is blacklisted"));
    }
    if let Some(uid) = claims.user_id()
        && !users::is_active(&state.db, uid).await?
    {
        return Err(ApiError::unauthorized(
            "No active account found for the given token.",
        ));
    }
    let access = jwt::access_from_refresh(&state.jwt, &state.config, &claims);
    Ok(with_jwt_cookie(json!({"access": access}), &access))
}

fn token_error_msg(msg: &str) -> ApiError {
    let mut err = ApiError::unauthorized(msg);
    err.errors.push(FieldError {
        field: "code".into(),
        message: "token_not_valid".into(),
    });
    err
}

async fn blacklist(
    State(state): State<AppState>,
    ApiJson(body): ApiJson<RefreshBody>,
) -> ApiResult<Response> {
    let v = validate(vec![required_str("refresh", &body.refresh)])?;
    let claims = jwt::decode(&state.jwt, &v[0], REFRESH).map_err(token_error)?;
    if users::refresh_revoked(&state.db, &claims.jti).await? {
        return Err(token_error_msg("Token is blacklisted"));
    }
    if let Some(uid) = claims.user_id() {
        lp_db::write::auth::revoke_refresh(&state.db, &claims.jti, uid, ts(claims.exp)).await?;
    }
    Ok((StatusCode::OK, Json(json!({}))).into_response())
}
