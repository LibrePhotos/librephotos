//! OIDC single sign-on against an in-test identity provider: discovery,
//! JWKS, authorize, token and userinfo endpoints with an RS256 key. Covers
//! the adapter policy of `api/adapters.py` (link by verified email,
//! provisioning gated on OIDC_ALLOW_SIGNUP + email, never privileged,
//! returning identities by `sub`) and `sso_finish` (cookies + redirect).
//! One test: the env vars it sets are process-wide.

#![allow(clippy::disallowed_methods)]

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use axum::extract::{Form, Query, State};
use axum::http::{HeaderMap, Request, StatusCode, header};
use axum::response::{IntoResponse, Redirect, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use lp_testkit::TestApp;
use openidconnect::core::{
    CoreGenderClaim, CoreIdToken, CoreIdTokenClaims, CoreJsonWebKeySet, CoreJwsSigningAlgorithm,
    CoreRsaPrivateSigningKey,
};
use openidconnect::{
    AccessToken, Audience, EmptyAdditionalClaims, EndUserEmail, EndUserUsername, IssuerUrl,
    JsonWebKeyId, Nonce, PrivateSigningKey, StandardClaims, SubjectIdentifier,
};
use serde_json::{Value, json};

/// The mock IdP's port, an ephemeral one picked when it starts.
static PORT: std::sync::OnceLock<u16> = std::sync::OnceLock::new();
const CLIENT_ID: &str = "lp-client";
const CLIENT_SECRET: &str = "lp-s3cret";
const PEM: &str = include_str!("fixtures/oidc_test_rsa.pem");

#[derive(Clone, Debug)]
struct Person {
    sub: String,
    email: String,
    verified: bool,
    username: String,
}

#[derive(Default)]
struct Idp {
    /// The identity the next /authorize hands out.
    next: Option<Person>,
    /// code -> (person, nonce)
    codes: HashMap<String, (Person, Option<String>)>,
    /// access token -> person
    tokens: HashMap<String, Person>,
    corrupt_signature: bool,
    token_requests: Vec<HashMap<String, String>>,
}

type Shared = Arc<Mutex<Idp>>;

fn issuer() -> String {
    format!(
        "http://127.0.0.1:{}",
        PORT.get().expect("the mock IdP runs")
    )
}

fn key() -> CoreRsaPrivateSigningKey {
    CoreRsaPrivateSigningKey::from_pem(PEM, Some(JsonWebKeyId::new("k1".into()))).unwrap()
}

async fn discovery() -> Json<Value> {
    let i = issuer();
    Json(json!({
        "issuer": i,
        "authorization_endpoint": format!("{i}/authorize"),
        "token_endpoint": format!("{i}/token"),
        "userinfo_endpoint": format!("{i}/userinfo"),
        "jwks_uri": format!("{i}/jwks"),
        "response_types_supported": ["code"],
        "subject_types_supported": ["public"],
        "id_token_signing_alg_values_supported": ["RS256"],
        "token_endpoint_auth_methods_supported": ["client_secret_post", "client_secret_basic"],
    }))
}

async fn jwks() -> Json<CoreJsonWebKeySet> {
    Json(CoreJsonWebKeySet::new(vec![key().as_verification_key()]))
}

async fn authorize(
    State(idp): State<Shared>,
    Query(q): Query<HashMap<String, String>>,
) -> Response {
    let mut idp = idp.lock().unwrap();
    assert_eq!(q.get("client_id").map(String::as_str), Some(CLIENT_ID));
    assert_eq!(q.get("response_type").map(String::as_str), Some("code"));
    let scope = q.get("scope").cloned().unwrap_or_default();
    assert!(
        scope.contains("openid") && scope.contains("email"),
        "{scope}"
    );
    let person = idp.next.clone().expect("a person to log in");
    let code = uuid::Uuid::new_v4().simple().to_string();
    idp.codes
        .insert(code.clone(), (person, q.get("nonce").cloned()));
    let redirect = format!(
        "{}?code={code}&state={}",
        q["redirect_uri"],
        urlencoding::encode(&q["state"])
    );
    Redirect::to(&redirect).into_response()
}

async fn token(State(idp): State<Shared>, Form(f): Form<HashMap<String, String>>) -> Response {
    let mut idp = idp.lock().unwrap();
    idp.token_requests.push(f.clone());
    if f.get("client_secret").map(String::as_str) != Some(CLIENT_SECRET) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({"error": "invalid_client"})),
        )
            .into_response();
    }
    let Some((person, nonce)) = f.get("code").and_then(|c| idp.codes.remove(c)) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "invalid_grant"})),
        )
            .into_response();
    };
    let access = uuid::Uuid::new_v4().simple().to_string();
    let now = chrono::Utc::now();
    let mut claims = CoreIdTokenClaims::new(
        IssuerUrl::new(issuer()).unwrap(),
        vec![Audience::new(CLIENT_ID.into())],
        now + chrono::Duration::minutes(5),
        now,
        StandardClaims::<CoreGenderClaim>::new(SubjectIdentifier::new(person.sub.clone())),
        EmptyAdditionalClaims {},
    );
    if let Some(n) = nonce {
        claims = claims.set_nonce(Some(Nonce::new(n)));
    }
    let id_token = CoreIdToken::new(
        claims,
        &key(),
        CoreJwsSigningAlgorithm::RsaSsaPkcs1V15Sha256,
        Some(&AccessToken::new(access.clone())),
        None,
    )
    .unwrap();
    let mut id_token = id_token.to_string();
    if idp.corrupt_signature {
        // A character inside the signature (the last one may only carry
        // padding bits a lenient decoder ignores).
        let i = id_token.len() - 20;
        let c = if &id_token[i..=i] == "A" { "B" } else { "A" };
        id_token.replace_range(i..=i, c);
    }
    idp.tokens.insert(access.clone(), person);
    Json(json!({
        "access_token": access,
        "token_type": "Bearer",
        "expires_in": 300,
        "id_token": id_token,
    }))
    .into_response()
}

async fn userinfo(State(idp): State<Shared>, headers: HeaderMap) -> Response {
    let idp = idp.lock().unwrap();
    let bearer = headers
        .get(header::AUTHORIZATION)
        .and_then(|h| h.to_str().ok())
        .and_then(|h| h.strip_prefix("Bearer "))
        .unwrap_or("");
    let Some(p) = idp.tokens.get(bearer) else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    let claims = StandardClaims::<CoreGenderClaim>::new(SubjectIdentifier::new(p.sub.clone()))
        .set_email(Some(EndUserEmail::new(p.email.clone())))
        .set_email_verified(Some(p.verified))
        .set_preferred_username(Some(EndUserUsername::new(p.username.clone())));
    Json(claims).into_response()
}

async fn start_idp() -> Shared {
    let idp: Shared = Arc::default();
    let app = Router::new()
        .route("/.well-known/openid-configuration", get(discovery))
        .route(
            "/moved/.well-known/openid-configuration",
            get(|| async {
                Redirect::permanent(&format!("{}/.well-known/openid-configuration", issuer()))
            }),
        )
        .route("/jwks", get(jwks))
        .route("/authorize", get(authorize))
        .route("/token", post(token))
        .route("/userinfo", get(userinfo))
        .with_state(idp.clone());
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
        .await
        .expect("bind the mock IdP port");
    PORT.set(listener.local_addr().unwrap().port())
        .expect("one mock IdP per test binary");
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    idp
}

fn cookies(res: &lp_testkit::TestResponse) -> HashMap<String, String> {
    res.headers
        .get_all(header::SET_COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .filter_map(|v| v.split(';').next())
        .filter_map(|kv| kv.split_once('='))
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect()
}

fn location(res: &lp_testkit::TestResponse) -> String {
    res.header("location").unwrap_or_default().to_string()
}

/// Run the whole browser round trip for `person`; the callback response.
async fn sso(app: &TestApp, idp: &Shared, person: &Person) -> lp_testkit::TestResponse {
    idp.lock().unwrap().next = Some(person.clone());
    let start = app.get("/api/accounts/oidc/mock/login/", None).await;
    assert_eq!(start.status, StatusCode::FOUND, "{}", start.text());
    let authorize = location(&start);
    assert!(authorize.starts_with(&format!("{}/authorize?", issuer())));
    let state_cookie = cookies(&start)["lp_oidc"].clone();
    // The "browser" follows the IdP's redirect back to the callback.
    let http = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap();
    let back = http.get(&authorize).send().await.unwrap();
    let callback = back.headers()["location"].to_str().unwrap().to_string();
    let path = callback
        .strip_prefix("https://photos.example.test")
        .expect("callback on the public URL")
        .to_string();
    assert!(path.starts_with("/api/accounts/oidc/mock/login/callback/?"));
    app.request(
        Request::get(path)
            .header(header::COOKIE, format!("lp_oidc={state_cookie}"))
            .body(axum::body::Body::empty())
            .unwrap(),
    )
    .await
}

fn user_of(app: &TestApp, res: &lp_testkit::TestResponse) -> i32 {
    assert_eq!(res.status, StatusCode::FOUND);
    assert_eq!(location(res), "/", "{:?}", res.headers);
    let c = cookies(res);
    assert_eq!(c["access"], c["jwt"]);
    assert!(!c["refresh"].is_empty());
    assert_eq!(c.get("lp_oidc").map(String::as_str), Some(""));
    let claims = lp_auth::jwt::decode(&app.state.jwt, &c["access"], lp_auth::jwt::ACCESS).unwrap();
    lp_auth::jwt::decode(&app.state.jwt, &c["refresh"], lp_auth::jwt::REFRESH).unwrap();
    claims.user_id().unwrap()
}

async fn count(app: &TestApp, sql: &str, id: i32) -> i64 {
    lp_db::sql::query_scalar(sql)
        .bind(id)
        .fetch_one(app.pool())
        .await
        .unwrap()
}

#[tokio::test]
async fn oidc_login_follows_the_adapter_policy() {
    // SAFETY: set before any other thread of this test binary reads them.
    unsafe {
        std::env::set_var("FRONTEND_BASE_URL", "https://photos.example.test");
        std::env::remove_var("LP_OIDC_PROVIDERS");
    }
    let idp = start_idp().await;
    let app = TestApp::new().await;
    let db = app.pool();
    let app_id: i32 = lp_db::sql::query_scalar(
        "INSERT INTO socialaccount_socialapp (provider, name, client_id, secret, key, provider_id, settings) \
         VALUES ('openid_connect', 'Mock IdP', $1, $2, '', 'mock', $3) RETURNING id",
    )
    .bind(CLIENT_ID)
    .bind(CLIENT_SECRET)
    .bind(json!({"server_url": issuer()}))
    .fetch_one(db)
    .await
    .unwrap();

    // Off: the endpoints do not exist.
    let off = app.get("/api/accounts/oidc/mock/login/", None).await;
    assert_eq!(off.status, StatusCode::NOT_FOUND);
    lp_db::write::settings::save(&app.state, &[("OIDC_ENABLED", json!(true))])
        .await
        .unwrap();
    // An app not attached to SITE_ID 1 is invisible to allauth.
    let unattached = app.get("/api/accounts/oidc/mock/login/", None).await;
    assert_eq!(unattached.status, StatusCode::NOT_FOUND);
    lp_db::sql::query(
        "INSERT INTO socialaccount_socialapp_sites (socialapp_id, site_id) VALUES ($1, 1)",
    )
    .bind(app_id)
    .execute(db)
    .await
    .unwrap();
    let unknown = app.get("/api/accounts/oidc/nope/login/", None).await;
    assert_eq!(unknown.status, StatusCode::NOT_FOUND);

    let config = app.get("/api/auth/sso/config/", None).await.json();
    assert_eq!(
        config["providers"],
        json!([{"id": "mock", "name": "Mock IdP", "login_url": "/api/accounts/oidc/mock/login/"}])
    );
    assert_eq!(config["enabled"], true);

    // A redirect_uri the browser cannot follow is refused before the IdP.
    unsafe { std::env::set_var("FRONTEND_BASE_URL", "http://backend") };
    let internal = app.get("/api/accounts/oidc/mock/login/", None).await;
    assert_eq!(
        location(&internal),
        "/login?sso_error=public_url_not_configured"
    );
    unsafe { std::env::set_var("FRONTEND_BASE_URL", "https://photos.example.test") };

    // A discovery document that moved is followed, like allauth's session.
    let set_server_url = |url: String| {
        lp_db::sql::query("UPDATE socialaccount_socialapp SET settings = $2 WHERE id = $1")
            .bind(app_id)
            .bind(json!({ "server_url": url }))
            .execute(db)
    };
    set_server_url(format!("{}/moved", issuer())).await.unwrap();
    let moved = app.get("/api/accounts/oidc/mock/login/", None).await;
    assert!(
        location(&moved).starts_with(&format!("{}/authorize?", issuer())),
        "{:?}",
        moved.headers
    );
    set_server_url(issuer()).await.unwrap();

    // No account with that email and signup off.
    let stranger = Person {
        sub: "sub-stranger".into(),
        email: "stranger@example.test".into(),
        verified: true,
        username: "stranger".into(),
    };
    let res = sso(&app, &idp, &stranger).await;
    assert_eq!(location(&res), "/login?sso_error=signup_disabled");
    let req = idp.lock().unwrap().token_requests.last().cloned().unwrap();
    assert_eq!(
        req["redirect_uri"],
        "https://photos.example.test/api/accounts/oidc/mock/login/callback/"
    );
    assert_eq!(req["client_id"], CLIENT_ID, "client_secret_post preferred");

    // An existing account is linked by a verified email only.
    let alice = app.create_user("alice_sso", "pw", true).await;
    lp_db::sql::query("UPDATE api_user SET email = 'Alice@Example.test' WHERE id = $1")
        .bind(alice.id)
        .execute(db)
        .await
        .unwrap();
    let mut alice_idp = Person {
        sub: "sub-alice".into(),
        email: "alice@example.TEST".into(),
        verified: false,
        username: "alice".into(),
    };
    let res = sso(&app, &idp, &alice_idp).await;
    assert_eq!(location(&res), "/login?sso_error=email_not_verified");
    alice_idp.verified = true;
    let res = sso(&app, &idp, &alice_idp).await;
    assert_eq!(user_of(&app, &res), alice.id);
    assert_eq!(
        count(
            &app,
            "SELECT count(*) FROM socialaccount_socialaccount WHERE user_id = $1 \
             AND provider = 'mock' AND uid = 'sub-alice'",
            alice.id
        )
        .await,
        1
    );
    assert_eq!(
        count(
            &app,
            "SELECT count(*) FROM refresh_token WHERE user_id = $1",
            alice.id
        )
        .await,
        1,
        "the refresh token is recorded like a password login's"
    );
    // A returning identity is found by `sub`, whatever its email says now.
    alice_idp.email = "new-address@example.test".into();
    alice_idp.verified = false;
    let res = sso(&app, &idp, &alice_idp).await;
    assert_eq!(user_of(&app, &res), alice.id);

    // Tampered ID token signature, IdP error, state problems.
    idp.lock().unwrap().corrupt_signature = true;
    let res = sso(&app, &idp, &alice_idp).await;
    assert_eq!(location(&res), "/login?sso_error=provider_error");
    idp.lock().unwrap().corrupt_signature = false;
    let res = app
        .get(
            "/api/accounts/oidc/mock/login/callback/?error=access_denied&state=x",
            None,
        )
        .await;
    assert_eq!(location(&res), "/login?sso_error=provider_error");
    let res = app
        .get(
            "/api/accounts/oidc/mock/login/callback/?code=x&state=y",
            None,
        )
        .await;
    assert_eq!(location(&res), "/login?sso_error=invalid_state");
    let start = app.get("/api/accounts/oidc/mock/login/", None).await;
    let cookie = cookies(&start)["lp_oidc"].clone();
    let res = app
        .request(
            Request::get("/api/accounts/oidc/mock/login/callback/?code=x&state=forged")
                .header(header::COOKIE, format!("lp_oidc={cookie}"))
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await;
    assert_eq!(location(&res), "/login?sso_error=invalid_state");

    // Provisioning: needs OIDC_ALLOW_SIGNUP and a configured email provider.
    lp_db::write::settings::save(&app.state, &[("OIDC_ALLOW_SIGNUP", json!(true))])
        .await
        .unwrap();
    let res = sso(&app, &idp, &stranger).await;
    assert_eq!(location(&res), "/login?sso_error=signup_disabled");
    lp_db::sql::query(
        "INSERT INTO api_emailconfig (id, provider, from_email, host, port, use_tls, use_ssl, \
           username, secret) VALUES (1, 'custom', 'lp@example.test', 'smtp.example.test', 587, \
           TRUE, FALSE, '', '') \
         ON CONFLICT (id) DO UPDATE SET provider = 'custom', host = 'smtp.example.test', \
           from_email = 'lp@example.test'",
    )
    .execute(db)
    .await
    .unwrap();
    let unverified = Person {
        verified: false,
        ..stranger.clone()
    };
    let res = sso(&app, &idp, &unverified).await;
    assert_eq!(location(&res), "/login?sso_error=email_not_verified");
    // A taken preferred_username gets a suffix.
    app.create_user("stranger", "pw", false).await;
    let res = sso(&app, &idp, &stranger).await;
    let new_id = user_of(&app, &res);
    let row: (String, String, bool, bool, String) = lp_db::sql::query_as(
        "SELECT username, email, is_staff, is_superuser, password FROM api_user WHERE id = $1",
    )
    .bind(new_id)
    .fetch_one(db)
    .await
    .unwrap();
    assert_eq!(row.0, "stranger2");
    assert_eq!(row.1, "stranger@example.test");
    assert!(!row.2 && !row.3, "SSO accounts are never privileged");
    assert!(
        row.4.starts_with('!') && row.4.len() == 41,
        "unusable password"
    );
    assert_eq!(
        count(
            &app,
            "SELECT count(*) FROM account_emailaddress WHERE user_id = $1 AND verified AND \"primary\"",
            new_id
        )
        .await,
        1
    );
    // Logging in again finds the same account.
    let res = sso(&app, &idp, &stranger).await;
    assert_eq!(user_of(&app, &res), new_id);

    // An email two accounts share is never linked or provisioned.
    for name in ["twin_a", "twin_b"] {
        let u = app.create_user(name, "pw", false).await;
        lp_db::sql::query("UPDATE api_user SET email = 'twin@example.test' WHERE id = $1")
            .bind(u.id)
            .execute(db)
            .await
            .unwrap();
    }
    let twin = Person {
        sub: "sub-twin".into(),
        email: "twin@example.test".into(),
        verified: true,
        username: "twin".into(),
    };
    let res = sso(&app, &idp, &twin).await;
    assert_eq!(location(&res), "/login?sso_error=ambiguous_email");

    // Inactive accounts do not get tokens.
    lp_db::sql::query("UPDATE api_user SET is_active = FALSE WHERE id = $1")
        .bind(alice.id)
        .execute(db)
        .await
        .unwrap();
    let res = sso(&app, &idp, &alice_idp).await;
    assert_eq!(location(&res), "/login?sso_error=account_inactive");

    app.cleanup().await;
}
