//! Auth extractors (port of `api/authentication.py` `JWTCookieAuthentication`).
//!
//! * `Authorization: Bearer <access>` (scheme case-insensitive) wins; a bad
//!   header token is a 401 even on endpoints that allow anonymous access.
//! * Otherwise the `jwt` cookie; an unusable cookie (expired, refresh token,
//!   inactive user) authenticates nobody instead of failing the request.
//! * The token's user must exist and be active.

use axum::extract::FromRequestParts;
use axum::http::header::{AUTHORIZATION, COOKIE};
use axum::http::request::Parts;
use axum::http::{HeaderValue, StatusCode};
use lp_core::{ApiError, AppState};
use lp_db::users::{self, User};

use crate::jwt::{self, ACCESS};

pub const JWT_COOKIE: &str = "jwt";

/// A signed-in, active user (401 otherwise).
#[derive(Debug, Clone)]
pub struct AuthUser(pub User);

/// The signed-in user if any; anonymous requests pass through.
#[derive(Debug, Clone)]
pub struct OptionalUser(pub Option<User>);

/// A signed-in staff user (DRF `IsAdminUser`: `is_staff`); 403 for others.
#[derive(Debug, Clone)]
pub struct AdminUser(pub User);

impl std::ops::Deref for AuthUser {
    type Target = User;
    fn deref(&self) -> &User {
        &self.0
    }
}

impl std::ops::Deref for AdminUser {
    type Target = User;
    fn deref(&self) -> &User {
        &self.0
    }
}

fn invalid_token() -> ApiError {
    let mut e = ApiError::unauthorized("Given token not valid for any token type");
    e.errors.push(lp_core::FieldError {
        field: "code".into(),
        message: "token_not_valid".into(),
    });
    e
}

/// Raw bearer token from the header: `Ok(None)` when absent or another scheme.
fn header_token(parts: &Parts) -> Result<Option<String>, ApiError> {
    let Some(value) = parts.headers.get(AUTHORIZATION) else {
        return Ok(None);
    };
    let text = value.to_str().unwrap_or("");
    let pieces: Vec<&str> = text.split_whitespace().collect();
    match pieces.first() {
        Some(scheme) if scheme.eq_ignore_ascii_case("bearer") => {}
        _ => return Ok(None),
    }
    if pieces.len() != 2 {
        return Err(ApiError::unauthorized(
            "Authorization header must contain two space-delimited values",
        ));
    }
    Ok(Some(pieces[1].to_string()))
}

/// Value of the `jwt` cookie, if sent.
pub fn cookie_token(parts: &Parts) -> Option<String> {
    for header in parts.headers.get_all(COOKIE) {
        let Ok(text) = header.to_str() else { continue };
        for c in cookie::Cookie::split_parse(text).flatten() {
            if c.name() == JWT_COOKIE {
                return Some(c.value().to_string());
            }
        }
    }
    None
}

async fn user_for_token(state: &AppState, token: &str) -> Result<User, ApiError> {
    let claims = jwt::decode(&state.jwt, token, ACCESS).map_err(|_| invalid_token())?;
    let uid = claims.user_id().ok_or_else(|| {
        ApiError::unauthorized("Token contained no recognizable user identification")
    })?;
    let user = users::by_id(&state.db, uid)
        .await?
        .ok_or_else(|| ApiError::unauthorized("User not found"))?;
    if !user.is_active {
        return Err(ApiError::unauthorized("User is inactive"));
    }
    Ok(user)
}

/// The requester, or None for anonymous. Cached in the request extensions.
async fn resolve(parts: &mut Parts, state: &AppState) -> Result<Option<User>, ApiError> {
    if let Some(u) = parts.extensions.get::<User>() {
        return Ok(Some(u.clone()));
    }
    let resolved = if let Some(token) = header_token(parts)? {
        Some(user_for_token(state, &token).await?)
    } else if let Some(token) = cookie_token(parts) {
        match user_for_token(state, &token).await {
            Ok(u) => Some(u),
            Err(e) if e.status == StatusCode::UNAUTHORIZED => None,
            Err(e) => return Err(e),
        }
    } else {
        None
    };
    if let Some(u) = &resolved {
        parts.extensions.insert(u.clone());
    }
    Ok(resolved)
}

impl FromRequestParts<AppState> for AuthUser {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, ApiError> {
        resolve(parts, state)
            .await?
            .map(AuthUser)
            .ok_or_else(ApiError::not_authenticated)
    }
}

impl FromRequestParts<AppState> for OptionalUser {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, ApiError> {
        Ok(OptionalUser(resolve(parts, state).await?))
    }
}

impl FromRequestParts<AppState> for AdminUser {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, ApiError> {
        let AuthUser(u) = AuthUser::from_request_parts(parts, state).await?;
        if !u.is_admin() {
            return Err(ApiError::permission_denied());
        }
        Ok(AdminUser(u))
    }
}

/// `Set-Cookie: jwt=<access>; Path=/` exactly as Django's `set_cookie` (not HttpOnly).
pub fn jwt_cookie_header(access: &str) -> HeaderValue {
    HeaderValue::from_str(&format!("{JWT_COOKIE}={access}; Path=/"))
        .expect("JWT characters are header-safe")
}
