//! Auth extractors.
//!
//! * [`AuthUser`] / [`OptionalUser`] / [`AdminUser`] are DRF's default
//!   authentication (simplejwt `JWTAuthentication`): only an `Authorization`
//!   header whose scheme is exactly `Bearer` identifies anyone; a bad token
//!   there is a 401 even on endpoints that allow anonymous access. The ambient
//!   `jwt` cookie is ignored, so a cross-site request carries no credentials.
//! * [`CookieUser`] / [`CookieOptionalUser`] are `api/authentication.py`
//!   `JWTCookieAuthentication`, for media and download requests a browser
//!   makes without headers: the header (scheme case-insensitive) wins, else
//!   the `jwt` cookie; an unusable cookie (expired, refresh token, inactive
//!   user) authenticates nobody instead of failing the request.
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

/// [`AuthUser`] that also accepts the `jwt` cookie (media, downloads).
#[derive(Debug, Clone)]
pub struct CookieUser(pub User);

/// [`OptionalUser`] that also accepts the `jwt` cookie (media).
#[derive(Debug, Clone)]
pub struct CookieOptionalUser(pub Option<User>);

impl std::ops::Deref for CookieUser {
    type Target = User;
    fn deref(&self) -> &User {
        &self.0
    }
}

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

/// Raw bearer token from the header: `Ok(None)` when absent or another
/// scheme. simplejwt matches the scheme exactly, the cookie class ignoring case.
fn header_token(parts: &Parts, any_case: bool) -> Result<Option<String>, ApiError> {
    let Some(value) = parts.headers.get(AUTHORIZATION) else {
        return Ok(None);
    };
    let text = value.to_str().unwrap_or("");
    let pieces: Vec<&str> = text.split_whitespace().collect();
    match pieces.first() {
        Some(scheme) if *scheme == "Bearer" => {}
        Some(scheme) if any_case && scheme.eq_ignore_ascii_case("bearer") => {}
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

#[derive(Clone)]
struct HeaderResolved(Option<User>);

#[derive(Clone)]
struct CookieResolved(Option<User>);

/// The requester by header only, or None for anonymous. Cached per request.
async fn resolve(parts: &mut Parts, state: &AppState) -> Result<Option<User>, ApiError> {
    if let Some(HeaderResolved(u)) = parts.extensions.get::<HeaderResolved>() {
        return Ok(u.clone());
    }
    let resolved = match header_token(parts, false)? {
        Some(token) => Some(user_for_token(state, &token).await?),
        None => None,
    };
    parts.extensions.insert(HeaderResolved(resolved.clone()));
    Ok(resolved)
}

/// The requester by header, else by cookie, or None for anonymous.
async fn resolve_with_cookie(
    parts: &mut Parts,
    state: &AppState,
) -> Result<Option<User>, ApiError> {
    if let Some(CookieResolved(u)) = parts.extensions.get::<CookieResolved>() {
        return Ok(u.clone());
    }
    let resolved = if let Some(token) = header_token(parts, true)? {
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
    parts.extensions.insert(CookieResolved(resolved.clone()));
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

impl FromRequestParts<AppState> for CookieUser {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, ApiError> {
        resolve_with_cookie(parts, state)
            .await?
            .map(CookieUser)
            .ok_or_else(ApiError::not_authenticated)
    }
}

impl FromRequestParts<AppState> for CookieOptionalUser {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, ApiError> {
        Ok(CookieOptionalUser(resolve_with_cookie(parts, state).await?))
    }
}

/// `Set-Cookie: jwt=<access>; Path=/` exactly as Django's `set_cookie` (not HttpOnly).
pub fn jwt_cookie_header(access: &str) -> HeaderValue {
    HeaderValue::from_str(&format!("{JWT_COOKIE}={access}; Path=/"))
        .expect("JWT characters are header-safe")
}
