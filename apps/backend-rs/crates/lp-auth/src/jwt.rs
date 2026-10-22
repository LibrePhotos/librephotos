//! simplejwt-compatible HS256 tokens. Django- and Rust-issued tokens are
//! interchangeable: same key (`SECRET_KEY`), same claim layout
//! (`token_type`, `exp`, `iat`, `jti`, `user_id` as a STRING like simplejwt
//! 5.5, then the custom claims of `CustomTokenObtainPairSerializer`).

use chrono::{Duration, Utc};
use jsonwebtoken::{Algorithm, Header, Validation};
use lp_core::{AppState, Config, JwtKeys};
use lp_db::users::User;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use uuid::Uuid;

pub const ACCESS: &str = "access";
pub const REFRESH: &str = "refresh";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Claims {
    pub token_type: String,
    pub exp: i64,
    pub iat: i64,
    pub jti: String,
    /// simplejwt 5.5 writes `str(user.id)`; older tokens carry an int.
    #[serde(default)]
    pub user_id: Value,
    /// Custom claims (`name`, `is_admin`, `first_name`, ...), copied from the
    /// refresh token into every access token minted from it.
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

impl Claims {
    pub fn user_id(&self) -> Option<i32> {
        match &self.user_id {
            Value::Number(n) => n.as_i64().and_then(|v| i32::try_from(v).ok()),
            Value::String(s) => s.trim().parse().ok(),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TokenError {
    Invalid,
    Expired,
    WrongType,
    NoType,
    NoId,
}

impl TokenError {
    /// simplejwt's message for the refresh/blacklist endpoints.
    pub fn message(self) -> &'static str {
        match self {
            TokenError::Invalid => "Token is invalid",
            TokenError::Expired => "Token is expired",
            TokenError::WrongType => "Token has wrong type",
            TokenError::NoType => "Token has no type",
            TokenError::NoId => "Token has no id",
        }
    }
}

pub struct TokenPair {
    pub refresh: String,
    pub access: String,
    pub refresh_claims: Claims,
}

fn encode(keys: &JwtKeys, claims: &Claims) -> String {
    jsonwebtoken::encode(&Header::new(Algorithm::HS256), claims, &keys.encoding)
        .expect("HS256 encoding of a plain struct cannot fail")
}

fn new_jti() -> String {
    Uuid::new_v4().simple().to_string()
}

/// The custom claims `CustomTokenObtainPairSerializer.get_token` adds.
pub fn user_claims(user: &User, nextcloud_enabled: bool) -> Map<String, Value> {
    let mut m = Map::new();
    m.insert("name".into(), user.username.clone().into());
    m.insert("is_admin".into(), user.is_superuser.into());
    m.insert("first_name".into(), user.first_name.clone().into());
    m.insert("last_name".into(), user.last_name.clone().into());
    m.insert("scan_directory".into(), user.scan_directory.clone().into());
    m.insert("confidence".into(), user.confidence.into());
    m.insert(
        "semantic_search_topk".into(),
        user.semantic_search_topk.into(),
    );
    if nextcloud_enabled {
        m.insert(
            "nextcloud_server_address".into(),
            user.nextcloud_server_address.clone().into(),
        );
        m.insert(
            "nextcloud_username".into(),
            user.nextcloud_username.clone().into(),
        );
    }
    m
}

/// Obtain: a refresh token with the user's claims plus an access token
/// derived from it (`RefreshToken.access_token`).
pub fn issue_pair(
    keys: &JwtKeys,
    config: &Config,
    user: &User,
    nextcloud_enabled: bool,
) -> TokenPair {
    let now = Utc::now().timestamp();
    let refresh_claims = Claims {
        token_type: REFRESH.into(),
        exp: now + Duration::days(config.refresh_token_days).num_seconds(),
        iat: now,
        jti: new_jti(),
        user_id: Value::String(user.id.to_string()),
        extra: user_claims(user, nextcloud_enabled),
    };
    let access = access_from_refresh(keys, config, &refresh_claims);
    TokenPair {
        refresh: encode(keys, &refresh_claims),
        access,
        refresh_claims,
    }
}

/// `RefreshToken.access_token`: copy every claim except token_type/exp/jti/iat.
pub fn access_from_refresh(keys: &JwtKeys, config: &Config, refresh: &Claims) -> String {
    let now = Utc::now().timestamp();
    let claims = Claims {
        token_type: ACCESS.into(),
        exp: now + Duration::minutes(config.access_token_minutes).num_seconds(),
        iat: now,
        jti: new_jti(),
        user_id: refresh.user_id.clone(),
        extra: refresh.extra.clone(),
    };
    encode(keys, &claims)
}

/// An access token for `user` (tests, SSO bridge).
pub fn mint_access(state: &AppState, user: &User) -> String {
    let pair = issue_pair(
        &state.jwt,
        &state.config,
        user,
        state.settings().nextcloud_enabled,
    );
    pair.access
}

/// Verify signature, expiry and `token_type`.
pub fn decode(keys: &JwtKeys, token: &str, expected_type: &str) -> Result<Claims, TokenError> {
    let mut validation = Validation::new(Algorithm::HS256);
    validation.leeway = 0;
    validation.validate_aud = false;
    validation.set_required_spec_claims(&["exp"]);
    let data = jsonwebtoken::decode::<Value>(token, &keys.decoding, &validation).map_err(|e| {
        match e.kind() {
            jsonwebtoken::errors::ErrorKind::ExpiredSignature => TokenError::Expired,
            _ => TokenError::Invalid,
        }
    })?;
    let obj = data.claims;
    match obj.get("token_type") {
        None => return Err(TokenError::NoType),
        Some(Value::String(t)) if t == expected_type => {}
        Some(_) => return Err(TokenError::WrongType),
    }
    if !obj.get("jti").is_some_and(|j| j.is_string()) {
        return Err(TokenError::NoId);
    }
    serde_json::from_value(obj).map_err(|_| TokenError::Invalid)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn keys() -> JwtKeys {
        JwtKeys::from_secret("rust-bench-secret")
    }

    #[test]
    fn decodes_django_shaped_token() {
        let claims = Claims {
            token_type: "access".into(),
            exp: Utc::now().timestamp() + 60,
            iat: Utc::now().timestamp(),
            jti: "abc".into(),
            user_id: Value::String("7".into()),
            extra: Map::new(),
        };
        let t = encode(&keys(), &claims);
        let back = decode(&keys(), &t, ACCESS).unwrap();
        assert_eq!(back.user_id(), Some(7));
        assert_eq!(decode(&keys(), &t, REFRESH), Err(TokenError::WrongType));
        assert_eq!(
            decode(&JwtKeys::from_secret("other"), &t, ACCESS),
            Err(TokenError::Invalid)
        );
        let expired = Claims {
            exp: Utc::now().timestamp() - 5,
            ..claims
        };
        assert_eq!(
            decode(&keys(), &encode(&keys(), &expired), ACCESS),
            Err(TokenError::Expired)
        );
    }

    #[test]
    fn int_user_id_accepted() {
        let c: Claims = serde_json::from_value(serde_json::json!({
            "token_type": "access", "exp": 1, "iat": 1, "jti": "x", "user_id": 3, "name": "a"
        }))
        .unwrap();
        assert_eq!(c.user_id(), Some(3));
        assert_eq!(c.extra["name"], "a");
    }
}
