//! DRF's default authentication for this area's views (simplejwt
//! `JWTAuthentication`, `DEFAULT_AUTHENTICATION_CLASSES`): only an
//! `Authorization` header whose scheme is exactly `Bearer` identifies anyone.
//! Django reads the ambient `jwt` cookie on media and upload views only
//! (api/authentication.py), so here a cookie never authenticates, and any
//! other scheme (`bearer`, `BEARER`, ...) is anonymous rather than a 401.
//!
//! The lp_auth extractors run on the request with the cookie (and a foreign
//! scheme header) hidden, then the headers are put back.

use axum::extract::FromRequestParts;
use axum::http::header::{AUTHORIZATION, COOKIE};
use axum::http::request::Parts;
use axum::http::{HeaderMap, HeaderName, HeaderValue};
use lp_auth::{AuthUser, OptionalUser};
use lp_core::{ApiError, AppState};
use lp_db::users::User;

/// A signed-in user by `Authorization: Bearer` (401 otherwise).
pub(super) struct ApiUser(pub User);

/// Anonymous is fine, but a bad `Authorization: Bearer` header is still a 401.
pub(super) struct ApiOptionalUser;

/// simplejwt's `get_raw_token` scheme test: the first run of the header split
/// on ASCII whitespace (Python `bytes.split()`) must be exactly `Bearer`.
fn simplejwt_scheme(headers: &HeaderMap) -> bool {
    headers.get(AUTHORIZATION).is_some_and(|v| {
        v.as_bytes()
            .split(|b| b" \t\n\r\x0b\x0c".contains(b))
            .find(|s| !s.is_empty())
            == Some(b"Bearer".as_slice())
    })
}

fn take(headers: &mut HeaderMap, name: HeaderName) -> Vec<HeaderValue> {
    let values = headers.get_all(&name).iter().cloned().collect();
    headers.remove(&name);
    values
}

async fn header_only<T>(parts: &mut Parts, state: &AppState) -> Result<T, ApiError>
where
    T: FromRequestParts<AppState, Rejection = ApiError>,
{
    let cookies = take(&mut parts.headers, COOKIE);
    let foreign = if simplejwt_scheme(&parts.headers) {
        Vec::new()
    } else {
        take(&mut parts.headers, AUTHORIZATION)
    };
    let res = T::from_request_parts(parts, state).await;
    for v in cookies {
        parts.headers.append(COOKIE, v);
    }
    for v in foreign {
        parts.headers.append(AUTHORIZATION, v);
    }
    res
}

impl FromRequestParts<AppState> for ApiUser {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, ApiError> {
        let AuthUser(user) = header_only(parts, state).await?;
        Ok(ApiUser(user))
    }
}

impl FromRequestParts<AppState> for ApiOptionalUser {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, ApiError> {
        let OptionalUser(_) = header_only(parts, state).await?;
        Ok(ApiOptionalUser)
    }
}
