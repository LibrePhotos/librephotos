//! OIDC single sign-on (`api/views/sso.py` + `api/adapters.py`, which run
//! allauth): `GET /api/accounts/oidc/<id>/login/` redirects to the identity
//! provider, `.../login/callback/` exchanges the code, applies LibrePhotos'
//! linking/provisioning policy and ends like `sso_finish`: the password
//! login's access/refresh pair in the `access`, `refresh` and `jwt` cookies
//! and a redirect to `/`. Failures go back to `/login?sso_error=<reason>`.
//!
//! Providers are allauth `SocialApp` rows (Django admin) when that table
//! exists, plus `LP_OIDC_PROVIDERS` (a JSON list of `{id, name, client_id,
//! secret, server_url, settings?}`) for databases Django never migrated.
//! allauth keeps the flow state in the Django session; here it is a signed,
//! short-lived HttpOnly cookie scoped to `/api/accounts/oidc/`.
//!
//! Differences from allauth: the ID token signature is always checked
//! against the provider's JWKS (allauth skips it for tokens fetched over
//! TLS), a nonce is sent and checked, IdP-side errors and state problems
//! redirect to the SPA instead of rendering allauth's error page, an email
//! shared by several accounts is refused (`ambiguous_email`) instead of
//! provisioning another account, and a taken `preferred_username` gets a
//! numeric suffix instead of allauth's (template-less) signup form.

use std::time::Duration;

use axum::extract::{Path, State};
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use chrono::{DateTime, Utc};
use hmac::{Hmac, Mac};
use lp_core::django_crypto::DjangoCrypto;
use lp_core::{ApiError, ApiResult, AppState, QueryMap};
use lp_db::users_settings::sso::{self, SocialApp};
use lp_db::write::users::NewUser;
use lp_db::write::users_settings::{SsoIdentity, create_sso_user, record_sso_login};
use openidconnect::core::{
    CoreAuthenticationFlow, CoreClient, CoreJsonWebKeySet, CoreProviderMetadata, CoreUserInfoClaims,
};
use openidconnect::{
    AccessToken, AuthType, AuthorizationCode, ClientId, ClientSecret, CsrfToken, Nonce,
    OAuth2TokenResponse, PkceCodeChallenge, PkceCodeVerifier, RedirectUrl, Scope, TokenResponse,
};
use rand::Rng;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::Sha256;
use subtle::ConstantTimeEq;

const STATE_COOKIE: &str = "lp_oidc";
const STATE_PATH: &str = "/api/accounts/oidc/";
const STATE_TTL_SECS: i64 = 600;

/// A configured OpenID Connect provider.
#[derive(Debug, Clone)]
pub struct Provider {
    pub id: String,
    pub name: String,
    pub client_id: String,
    pub secret: String,
    /// allauth `SocialApp.settings`: `server_url`, `token_auth_method`,
    /// `oauth_pkce_enabled`, `fetch_userinfo`, `scope`, `auth_params`.
    pub settings: Value,
}

impl From<SocialApp> for Provider {
    fn from(a: SocialApp) -> Self {
        Provider {
            id: a.id,
            name: a.name,
            client_id: a.client_id,
            secret: a.secret,
            settings: a.settings,
        }
    }
}

#[derive(Debug, Deserialize)]
struct EnvProvider {
    id: String,
    #[serde(default)]
    name: String,
    client_id: String,
    #[serde(default)]
    secret: String,
    server_url: String,
    #[serde(default)]
    settings: serde_json::Map<String, Value>,
}

/// `LP_OIDC_PROVIDERS`; a malformed value is logged and ignored.
fn env_providers() -> Vec<Provider> {
    let Ok(raw) = std::env::var("LP_OIDC_PROVIDERS") else {
        return Vec::new();
    };
    match serde_json::from_str::<Vec<EnvProvider>>(&raw) {
        Ok(list) => list
            .into_iter()
            .map(|p| {
                let mut settings = p.settings;
                settings.insert("server_url".into(), Value::String(p.server_url));
                Provider {
                    name: if p.name.is_empty() {
                        p.id.clone()
                    } else {
                        p.name
                    },
                    id: p.id,
                    client_id: p.client_id,
                    secret: p.secret,
                    settings: Value::Object(settings),
                }
            })
            .collect(),
        Err(e) => {
            tracing::error!(error = %e, "LP_OIDC_PROVIDERS is not a valid provider list");
            Vec::new()
        }
    }
}

/// Every provider the login screen can offer: `(id, name)`.
pub async fn list_providers(state: &AppState) -> sqlx::Result<Vec<(String, String)>> {
    let mut out = lp_db::users_settings::oidc_providers(&state.db).await?;
    for p in env_providers() {
        if !out.iter().any(|(id, _)| *id == p.id) {
            out.push((p.id, p.name));
        }
    }
    Ok(out)
}

async fn find_provider(state: &AppState, id: &str) -> sqlx::Result<Option<Provider>> {
    if let Some(app) = sso::social_app(&state.db, id).await? {
        return Ok(Some(app.into()));
    }
    Ok(env_providers().into_iter().find(|p| p.id == id))
}

/// `public_base_url`: `FRONTEND_BASE_URL`, else the request's origin.
fn public_base_url(headers: &HeaderMap) -> String {
    let configured = std::env::var("FRONTEND_BASE_URL").unwrap_or_default();
    let configured = configured.trim_end_matches('/');
    if !configured.is_empty() {
        return configured.to_string();
    }
    super::serialize::request_origin(headers)
}

/// `is_internal_base_url`: a host only the Docker network resolves.
fn is_internal_base_url(base: &str) -> bool {
    if base.is_empty() {
        return true;
    }
    let without_scheme = base.split_once("://").map_or(base, |(_, r)| r);
    let host = without_scheme
        .split('/')
        .next()
        .unwrap_or("")
        .split(':')
        .next()
        .unwrap_or("");
    let backend = std::env::var("BACKEND_HOST").unwrap_or_else(|_| "backend".into());
    host == "backend" || host == backend
}

fn redirect(location: &str) -> Response {
    (
        StatusCode::FOUND,
        [(header::LOCATION, location.to_string())],
    )
        .into_response()
}

/// `_login_error_redirect`.
fn sso_error(reason: &str) -> Response {
    let mut res = redirect(&format!("/login?sso_error={reason}"));
    res.headers_mut()
        .append(header::SET_COOKIE, clear_state_cookie());
    res
}

fn callback_url(base: &str, id: &str) -> String {
    format!(
        "{base}/api/accounts/oidc/{}/login/callback/",
        urlencoding::encode(id)
    )
}

fn discovery_url(server_url: &str) -> String {
    if server_url.contains("/.well-known/") {
        server_url.to_string()
    } else {
        format!(
            "{}/.well-known/openid-configuration",
            server_url.trim_end_matches('/')
        )
    }
}

fn setting<'a>(p: &'a Provider, key: &str) -> Option<&'a Value> {
    p.settings.get(key).filter(|v| !v.is_null())
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())
}

/// Discovery document plus its JWKS.
async fn metadata(http: &reqwest::Client, p: &Provider) -> Result<CoreProviderMetadata, String> {
    let server_url = setting(p, "server_url")
        .and_then(Value::as_str)
        .ok_or("provider has no server_url")?;
    let doc: Value = http
        .get(discovery_url(server_url))
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("discovery: {e}"))?
        .json()
        .await
        .map_err(|e| format!("discovery: {e}"))?;
    let meta: CoreProviderMetadata =
        serde_json::from_value(doc).map_err(|e| format!("discovery document: {e}"))?;
    let jwks = CoreJsonWebKeySet::fetch_async(meta.jwks_uri(), http)
        .await
        .map_err(|e| format!("jwks: {e}"))?;
    Ok(meta.set_jwks(jwks))
}

/// allauth's `basic_auth`: the app's `token_auth_method`, else basic auth
/// only when the provider supports it and not `client_secret_post`.
fn auth_type(p: &Provider, meta: &CoreProviderMetadata) -> AuthType {
    if let Some(m) = setting(p, "token_auth_method").and_then(Value::as_str) {
        return if m == "client_secret_basic" {
            AuthType::BasicAuth
        } else {
            AuthType::RequestBody
        };
    }
    let methods: Vec<String> = meta
        .token_endpoint_auth_methods_supported()
        .map(|ms| ms.iter().map(|m| m.as_ref().to_string()).collect())
        .unwrap_or_default();
    if !methods.iter().any(|m| m == "client_secret_post")
        && methods.iter().any(|m| m == "client_secret_basic")
    {
        AuthType::BasicAuth
    } else {
        AuthType::RequestBody
    }
}

/// What the callback needs back, signed into the state cookie.
#[derive(Debug, Serialize, Deserialize)]
struct FlowState {
    /// Provider id.
    p: String,
    /// OAuth `state`.
    s: String,
    /// Nonce.
    n: String,
    /// PKCE verifier.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    v: Option<String>,
    /// Expiry (unix seconds).
    e: i64,
}

fn state_key(secret: &str) -> Hmac<Sha256> {
    let mut derive =
        Hmac::<Sha256>::new_from_slice(secret.as_bytes()).expect("HMAC takes any key length");
    derive.update(b"librephotos.oidc.state");
    let key = derive.finalize().into_bytes();
    Hmac::<Sha256>::new_from_slice(&key).expect("HMAC takes any key length")
}

fn sign_state(secret: &str, flow: &FlowState) -> String {
    let body = URL_SAFE_NO_PAD.encode(serde_json::to_vec(flow).expect("serializable"));
    let mut mac = state_key(secret);
    mac.update(body.as_bytes());
    let sig = URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes());
    format!("{body}.{sig}")
}

fn verify_state(secret: &str, value: &str) -> Option<FlowState> {
    let (body, sig) = value.split_once('.')?;
    let mut mac = state_key(secret);
    mac.update(body.as_bytes());
    let expected = URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes());
    if !bool::from(expected.as_bytes().ct_eq(sig.as_bytes())) {
        return None;
    }
    let flow: FlowState = serde_json::from_slice(&URL_SAFE_NO_PAD.decode(body).ok()?).ok()?;
    (flow.e > Utc::now().timestamp()).then_some(flow)
}

fn state_cookie(value: &str, secure: bool) -> HeaderValue {
    let secure = if secure { "; Secure" } else { "" };
    HeaderValue::from_str(&format!(
        "{STATE_COOKIE}={value}; Path={STATE_PATH}; Max-Age={STATE_TTL_SECS}; HttpOnly; \
         SameSite=Lax{secure}"
    ))
    .expect("cookie characters are header-safe")
}

fn clear_state_cookie() -> HeaderValue {
    HeaderValue::from_str(&format!(
        "{STATE_COOKIE}=; Path={STATE_PATH}; Max-Age=0; HttpOnly; SameSite=Lax"
    ))
    .expect("static cookie")
}

fn cookie_value(headers: &HeaderMap, name: &str) -> Option<String> {
    headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(';'))
        .filter_map(|c| c.trim().split_once('='))
        .find(|(k, _)| *k == name)
        .map(|(_, v)| v.to_string())
}

fn enabled_or_404(state: &AppState) -> ApiResult<()> {
    if state.settings().oidc_enabled {
        Ok(())
    } else {
        Err(ApiError::not_found())
    }
}

/// `oidc_login`.
pub async fn login(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> ApiResult<Response> {
    enabled_or_404(&state)?;
    let base = public_base_url(&headers);
    if is_internal_base_url(&base) {
        return Ok(redirect("/login?sso_error=public_url_not_configured"));
    }
    let Some(provider) = find_provider(&state, &id).await? else {
        return Err(ApiError::not_found());
    };
    let started = async {
        let http = http_client()?;
        let meta = metadata(&http, &provider).await?;
        let redirect_url =
            RedirectUrl::new(callback_url(&base, &provider.id)).map_err(|e| e.to_string())?;
        let client = CoreClient::from_provider_metadata(
            meta,
            ClientId::new(provider.client_id.clone()),
            Some(ClientSecret::new(provider.secret.clone())),
        )
        .set_redirect_uri(redirect_url);
        let mut req = client.authorize_url(
            CoreAuthenticationFlow::AuthorizationCode,
            CsrfToken::new_random,
            Nonce::new_random,
        );
        let scopes: Vec<String> = match setting(&provider, "scope").and_then(Value::as_array) {
            Some(list) => list
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect(),
            None => vec!["profile".into(), "email".into()],
        };
        for s in scopes.into_iter().filter(|s| s != "openid") {
            req = req.add_scope(Scope::new(s));
        }
        if let Some(extra) = setting(&provider, "auth_params").and_then(Value::as_object) {
            for (k, v) in extra {
                if let Some(v) = v.as_str() {
                    req = req.add_extra_param(k.clone(), v.to_string());
                }
            }
        }
        let pkce = setting(&provider, "oauth_pkce_enabled")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let verifier = if pkce {
            let (challenge, verifier) = PkceCodeChallenge::new_random_sha256();
            req = req.set_pkce_challenge(challenge);
            Some(verifier.secret().clone())
        } else {
            None
        };
        let (url, csrf, nonce) = req.url();
        Ok::<_, String>((url, csrf, nonce, verifier))
    }
    .await;
    let (url, csrf, nonce, verifier) = match started {
        Ok(v) => v,
        Err(e) => {
            tracing::error!(provider = %provider.id, error = %e, "SSO login could not start");
            return Ok(sso_error("provider_error"));
        }
    };
    let flow = FlowState {
        p: provider.id.clone(),
        s: csrf.secret().clone(),
        n: nonce.secret().clone(),
        v: verifier,
        e: Utc::now().timestamp() + STATE_TTL_SECS,
    };
    let mut res = redirect(url.as_str());
    res.headers_mut().append(
        header::SET_COOKIE,
        state_cookie(
            &sign_state(&state.config.secret_key, &flow),
            base.starts_with("https://"),
        ),
    );
    Ok(res)
}

/// The identity the callback established.
#[derive(Debug, Default)]
struct Identity {
    uid: String,
    email: String,
    email_verified: bool,
    preferred_username: String,
    name: String,
    given_name: String,
    family_name: String,
    extra_data: Value,
}

/// `oidc_callback`: code exchange, then the adapter policy.
pub async fn callback(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    q: QueryMap,
) -> ApiResult<Response> {
    enabled_or_404(&state)?;
    let Some(provider) = find_provider(&state, &id).await? else {
        return Err(ApiError::not_found());
    };
    if let Some(err) = q.non_empty("error") {
        tracing::warn!(
            provider = %provider.id,
            error = err,
            description = q.non_empty("error_description").unwrap_or(""),
            "the identity provider refused the login"
        );
        return Ok(sso_error("provider_error"));
    }
    let flow = cookie_value(&headers, STATE_COOKIE)
        .and_then(|v| verify_state(&state.config.secret_key, &v))
        .filter(|f| f.p == provider.id);
    let Some(flow) = flow else {
        return Ok(sso_error("invalid_state"));
    };
    let state_param = q.non_empty("state").unwrap_or("");
    if !bool::from(state_param.as_bytes().ct_eq(flow.s.as_bytes())) {
        return Ok(sso_error("invalid_state"));
    }
    let Some(code) = q.non_empty("code").map(str::to_string) else {
        return Ok(sso_error("provider_error"));
    };
    let base = public_base_url(&headers);
    let identity = match exchange(&provider, &base, code, &flow).await {
        Ok(i) => i,
        Err(e) => {
            tracing::error!(provider = %provider.id, error = %e, "SSO callback failed");
            return Ok(sso_error("provider_error"));
        }
    };
    finish(&state, &provider, identity).await
}

async fn exchange(
    p: &Provider,
    base: &str,
    code: String,
    flow: &FlowState,
) -> Result<Identity, String> {
    let http = http_client()?;
    let meta = metadata(&http, p).await?;
    let auth = auth_type(p, &meta);
    let client = CoreClient::from_provider_metadata(
        meta,
        ClientId::new(p.client_id.clone()),
        Some(ClientSecret::new(p.secret.clone())),
    )
    .set_redirect_uri(RedirectUrl::new(callback_url(base, &p.id)).map_err(|e| e.to_string())?)
    .set_auth_type(auth);
    let mut req = client
        .exchange_code(AuthorizationCode::new(code))
        .map_err(|e| e.to_string())?;
    if let Some(v) = &flow.v {
        req = req.set_pkce_verifier(PkceCodeVerifier::new(v.clone()));
    }
    let token = req
        .request_async(&http)
        .await
        .map_err(|e| format!("token exchange: {e}"))?;
    let id_token = token
        .id_token()
        .ok_or("the token response has no id_token")?;
    let verifier = client
        .id_token_verifier()
        .set_allowed_algs(ALLOWED_ALGS.iter().cloned());
    let nonce = Nonce::new(flow.n.clone());
    let claims = id_token
        .claims(&verifier, &nonce)
        .map_err(|e| format!("id_token: {e}"))?;
    let id_json = serde_json::to_value(claims).unwrap_or(Value::Null);

    let mut ident = Identity {
        uid: claims.subject().as_str().to_string(),
        email: claims
            .email()
            .map(|e| e.as_str().to_string())
            .unwrap_or_default(),
        email_verified: claims.email_verified().unwrap_or(false),
        preferred_username: claims
            .preferred_username()
            .map(|u| u.as_str().to_string())
            .unwrap_or_default(),
        name: claims
            .name()
            .and_then(|n| n.get(None))
            .map(|n| n.as_str().to_string())
            .unwrap_or_default(),
        given_name: claims
            .given_name()
            .and_then(|n| n.get(None))
            .map(|n| n.as_str().to_string())
            .unwrap_or_default(),
        family_name: claims
            .family_name()
            .and_then(|n| n.get(None))
            .map(|n| n.as_str().to_string())
            .unwrap_or_default(),
        extra_data: json!({ "id_token": id_json }),
    };
    let fetch_userinfo = setting(p, "fetch_userinfo")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    if fetch_userinfo && client.user_info_url().is_some() {
        let access: AccessToken = token.access_token().clone();
        let info: CoreUserInfoClaims = client
            .user_info(access, Some(claims.subject().clone()))
            .map_err(|e| e.to_string())?
            .request_async(&http)
            .await
            .map_err(|e| format!("userinfo: {e}"))?;
        // allauth prefers the userinfo claims over the ID token's.
        ident.email = info
            .email()
            .map(|e| e.as_str().to_string())
            .unwrap_or_default();
        ident.email_verified = info.email_verified().unwrap_or(false);
        ident.preferred_username = info
            .preferred_username()
            .map(|u| u.as_str().to_string())
            .unwrap_or_default();
        ident.name = info
            .name()
            .and_then(|n| n.get(None))
            .map(|n| n.as_str().to_string())
            .unwrap_or_default();
        ident.given_name = info
            .given_name()
            .and_then(|n| n.get(None))
            .map(|n| n.as_str().to_string())
            .unwrap_or_default();
        ident.family_name = info
            .family_name()
            .and_then(|n| n.get(None))
            .map(|n| n.as_str().to_string())
            .unwrap_or_default();
        ident.extra_data["userinfo"] = serde_json::to_value(&info).unwrap_or(Value::Null);
    }
    Ok(ident)
}

use openidconnect::core::CoreJwsSigningAlgorithm as Alg;
/// Every signed algorithm (never `none`); the key type decides which verify.
const ALLOWED_ALGS: &[Alg] = &[
    Alg::RsaSsaPkcs1V15Sha256,
    Alg::RsaSsaPkcs1V15Sha384,
    Alg::RsaSsaPkcs1V15Sha512,
    Alg::RsaSsaPssSha256,
    Alg::RsaSsaPssSha384,
    Alg::RsaSsaPssSha512,
    Alg::EcdsaP256Sha256,
    Alg::EcdsaP384Sha384,
    Alg::EdDsa,
    Alg::HmacSha256,
    Alg::HmacSha384,
    Alg::HmacSha512,
];

/// `pre_social_login` + `save_user` + `sso_finish`.
async fn finish(state: &AppState, p: &Provider, ident: Identity) -> ApiResult<Response> {
    let identity = SsoIdentity {
        provider: &p.id,
        uid: &ident.uid,
        extra_data: &ident.extra_data,
    };
    let user_id = match sso::linked_user(&state.db, &p.id, &ident.uid).await? {
        Some(id) => id,
        None => {
            let email = ident.email.trim().to_lowercase();
            let matches = if email.is_empty() {
                Vec::new()
            } else {
                sso::users_with_email(&state.db, &email).await?
            };
            match matches.as_slice() {
                [one] => {
                    // Account-takeover guard: never attach an unverified email.
                    if !ident.email_verified {
                        return Ok(sso_error("email_not_verified"));
                    }
                    *one
                }
                [] => {
                    let allowed = state.settings().oidc_allow_signup
                        && super::email::email_is_configured(state).await;
                    if !allowed {
                        return Ok(sso_error("signup_disabled"));
                    }
                    if !ident.email_verified {
                        return Ok(sso_error("email_not_verified"));
                    }
                    let id = provision(state, &ident, &identity).await?;
                    if let Some(user) = lp_db::users::by_id(&state.db, id).await? {
                        super::scan_dir::auto_create(state, &user, false).await;
                    }
                    id
                }
                _ => return Ok(sso_error("ambiguous_email")),
            }
        }
    };
    let Some(user) = lp_db::users::by_id(&state.db, user_id).await? else {
        return Ok(sso_error("not_authenticated"));
    };
    if !user.is_active {
        return Ok(sso_error("account_inactive"));
    }
    record_sso_login(&state.db, user.id, &identity).await?;

    let pair = lp_auth::jwt::issue_pair(
        &state.jwt,
        &state.config,
        &user,
        state.settings().nextcloud_enabled,
    );
    lp_db::write::auth::record_refresh(
        &state.db,
        &pair.refresh_claims.jti,
        user.id,
        DateTime::from_timestamp(pair.refresh_claims.exp, 0).unwrap_or_else(Utc::now),
    )
    .await?;
    let mut res = redirect("/");
    let h = res.headers_mut();
    for (name, value) in [
        ("access", &pair.access),
        ("refresh", &pair.refresh),
        ("jwt", &pair.access),
    ] {
        h.append(
            header::SET_COOKIE,
            HeaderValue::from_str(&format!("{name}={value}; Path=/"))
                .map_err(ApiError::internal)?,
        );
    }
    h.append(header::SET_COOKIE, clear_state_cookie());
    h.insert(
        header::ACCESS_CONTROL_ALLOW_CREDENTIALS,
        HeaderValue::from_static("true"),
    );
    Ok(res)
}

/// Django's `UnicodeUsernameValidator` (`^[\w.@+-]+\Z`, 150 chars).
fn valid_username(u: &str) -> bool {
    !u.is_empty()
        && u.chars().count() <= 150
        && u.chars()
            .all(|c| c.is_alphanumeric() || matches!(c, '_' | '.' | '@' | '+' | '-'))
}

/// allauth `generate_unique_username` in spirit: the first usable of the
/// preferred username, email local part, names and "user", made unique with
/// a numeric suffix.
async fn unique_username(state: &AppState, ident: &Identity) -> sqlx::Result<String> {
    let local = ident.email.split('@').next().unwrap_or("").to_string();
    let candidates = [
        ident.preferred_username.clone(),
        local,
        ident.given_name.clone(),
        ident.family_name.clone(),
        "user".to_string(),
    ];
    let base = candidates
        .iter()
        .map(|c| {
            c.chars()
                .filter(|c| c.is_alphanumeric() || matches!(c, '_' | '.' | '@' | '+' | '-'))
                .take(140)
                .collect::<String>()
        })
        .find(|c| valid_username(c))
        .unwrap_or_else(|| "user".into());
    if !sso::username_taken(&state.db, &base).await? {
        return Ok(base);
    }
    for n in 2..1000 {
        let candidate = format!("{base}{n}");
        if !sso::username_taken(&state.db, &candidate).await? {
            return Ok(candidate);
        }
    }
    Ok(format!(
        "{base}{}",
        rand::thread_rng().gen_range(1000..1_000_000)
    ))
}

/// `save_user`: a new, never privileged account with an unusable password.
async fn provision(
    state: &AppState,
    ident: &Identity,
    identity: &SsoIdentity<'_>,
) -> ApiResult<i32> {
    let username = unique_username(state, ident).await?;
    let (first, last) = if ident.given_name.is_empty() && ident.family_name.is_empty() {
        match ident.name.split_once(' ') {
            Some((f, l)) => (f.to_string(), l.to_string()),
            None => (ident.name.clone(), String::new()),
        }
    } else {
        (ident.given_name.clone(), ident.family_name.clone())
    };
    // Django `make_password(None)`: "!" + 40 random characters.
    let unusable: String = std::iter::once('!')
        .chain(
            rand::thread_rng()
                .sample_iter(&rand::distributions::Alphanumeric)
                .take(40)
                .map(char::from),
        )
        .collect();
    let crypto = DjangoCrypto::new(&state.config.secret_key);
    let id = create_sso_user(
        &state.db,
        &crypto,
        &NewUser {
            username: &username,
            email: ident.email.trim(),
            password_hash: &unusable,
            first_name: &first.chars().take(150).collect::<String>(),
            last_name: &last.chars().take(150).collect::<String>(),
            is_superuser: false,
            is_staff: false,
            scan_directory: "",
        },
        ident.email_verified,
        identity,
    )
    .await?;
    tracing::info!(user = %username, "SSO login created a new account");
    Ok(id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn state_cookie_round_trip() {
        let flow = FlowState {
            p: "kc".into(),
            s: "abc".into(),
            n: "nonce".into(),
            v: None,
            e: Utc::now().timestamp() + 60,
        };
        let signed = sign_state("k1", &flow);
        let back = verify_state("k1", &signed).unwrap();
        assert_eq!((back.p.as_str(), back.s.as_str()), ("kc", "abc"));
        assert!(verify_state("k2", &signed).is_none(), "other secret");
        let tampered = signed.replacen('e', "f", 1);
        assert!(tampered == signed || verify_state("k1", &tampered).is_none());
        let expired = FlowState {
            e: Utc::now().timestamp() - 1,
            ..flow
        };
        assert!(verify_state("k1", &sign_state("k1", &expired)).is_none());
    }

    #[test]
    fn internal_hosts_and_discovery() {
        assert!(is_internal_base_url(""));
        assert!(is_internal_base_url("http://backend:8001"));
        assert!(!is_internal_base_url("https://photos.example.com"));
        assert!(!is_internal_base_url("http://localhost:3000"));
        assert_eq!(
            discovery_url("https://idp/realms/x/"),
            "https://idp/realms/x/.well-known/openid-configuration"
        );
        assert_eq!(
            discovery_url("https://idp/.well-known/openid-configuration"),
            "https://idp/.well-known/openid-configuration"
        );
        assert!(valid_username("a.b@c+d-e_f"));
        assert!(!valid_username("a b"));
    }
}
