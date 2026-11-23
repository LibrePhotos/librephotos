//! Token endpoints and extractors, end to end through the full app.

use axum::Router;
use axum::body::Body;
use axum::http::{Request, StatusCode};
use axum::routing::get;
use http_body_util::BodyExt;
use lp_auth::jwt::{self, ACCESS};
use lp_auth::{AdminUser, AuthUser, CookieOptionalUser, CookieUser, OptionalUser};
use lp_testkit::TestApp;
use serde_json::json;
use tower::ServiceExt;

fn unique(prefix: &str) -> String {
    format!(
        "{prefix}{}",
        &uuid::Uuid::new_v4().simple().to_string()[..8]
    )
}

#[tokio::test]
async fn obtain_refresh_blacklist() {
    let app = TestApp::new().await;
    let name = unique("alice");
    let user = app.create_user(&name, "pw-alice", false).await;

    let res = app
        .post_json(
            "/api/auth/token/obtain/",
            &json!({"username": name, "password": "pw-alice"}),
            None,
        )
        .await;
    assert_eq!(res.status, StatusCode::OK, "{}", res.text());
    let body = res.json();
    let access = body["access"].as_str().unwrap().to_string();
    let refresh = body["refresh"].as_str().unwrap().to_string();
    assert_eq!(
        res.header("set-cookie").unwrap(),
        format!("jwt={access}; Path=/")
    );
    let keys: Vec<_> = body.as_object().unwrap().keys().cloned().collect();
    assert_eq!(keys, vec!["refresh", "access"]);

    let claims = jwt::decode(&app.state.jwt, &access, ACCESS).unwrap();
    assert_eq!(claims.user_id(), Some(user.id));
    assert_eq!(claims.user_id, json!(user.id.to_string()));
    assert_eq!(claims.extra["name"], json!(name));
    assert_eq!(claims.extra["is_admin"], json!(false));
    assert_eq!(claims.exp - claims.iat, 300);

    // No trailing slash works too; refresh is not rotated.
    let res = app
        .post_json(
            "/api/auth/token/refresh",
            &json!({"refresh": refresh}),
            None,
        )
        .await;
    assert_eq!(res.status, StatusCode::OK, "{}", res.text());
    let fresh = res.json()["access"].as_str().unwrap().to_string();
    assert!(res.json().get("refresh").is_none());
    assert!(res.header("set-cookie").unwrap().starts_with("jwt="));
    let fresh_claims = jwt::decode(&app.state.jwt, &fresh, ACCESS).unwrap();
    assert_eq!(fresh_claims.extra["name"], json!(name));

    let res = app
        .post_json(
            "/api/auth/token/blacklist/",
            &json!({"refresh": refresh}),
            None,
        )
        .await;
    assert_eq!(res.status, StatusCode::OK);
    assert_eq!(res.json(), json!({}));

    let res = app
        .post_json(
            "/api/auth/token/refresh/",
            &json!({"refresh": refresh}),
            None,
        )
        .await;
    assert_eq!(res.status, StatusCode::UNAUTHORIZED);
    assert_eq!(
        res.json()["errors"][0],
        json!({"field": "detail", "message": "Token is blacklisted"})
    );

    // An access token is not a refresh token.
    let res = app
        .post_json(
            "/api/auth/token/refresh/",
            &json!({"refresh": access}),
            None,
        )
        .await;
    assert_eq!(res.status, StatusCode::UNAUTHORIZED);
    assert_eq!(res.json()["errors"][0]["message"], "Token has wrong type");

    app.cleanup().await;
}

#[tokio::test]
async fn obtain_errors_use_the_envelope() {
    let app = TestApp::shared().await;
    let name = unique("bob");
    app.create_user(&name, "right", false).await;

    let res = app
        .post_json(
            "/api/auth/token/obtain/",
            &json!({"username": name, "password": "wrong"}),
            None,
        )
        .await;
    assert_eq!(res.status, StatusCode::UNAUTHORIZED);
    assert_eq!(
        res.json(),
        json!({"errors": [{"field": "detail", "message": "No active account found with the given credentials"}]})
    );

    let res = app
        .post_json("/api/auth/token/obtain/", &json!({"password": "x"}), None)
        .await;
    assert_eq!(res.status, StatusCode::BAD_REQUEST);
    assert_eq!(
        res.json(),
        json!({"errors": [{"field": "username", "message": "This field is required."}]})
    );
    app.cleanup().await;
}

async fn call(router: &Router, req: Request<Body>) -> (StatusCode, String) {
    let res = router.clone().oneshot(req).await.unwrap();
    let status = res.status();
    let body = res.into_body().collect().await.unwrap().to_bytes();
    (status, String::from_utf8_lossy(&body).into_owned())
}

#[tokio::test]
async fn extractors_header_cookie_admin() {
    let app = TestApp::shared().await;
    let alice = app.create_user(&unique("alice"), "pw", false).await;
    let root = app.create_user(&unique("root"), "pw", true).await;
    let router: Router = Router::new()
        .route(
            "/me",
            get(|AuthUser(u): AuthUser| async move { u.username }),
        )
        .route(
            "/maybe",
            get(|OptionalUser(u): OptionalUser| async move {
                u.map(|u| u.username).unwrap_or_else(|| "anon".into())
            }),
        )
        .route(
            "/admin",
            get(|AdminUser(u): AdminUser| async move { u.username }),
        )
        .route(
            "/cookie",
            get(|CookieUser(u): CookieUser| async move { u.username }),
        )
        .route(
            "/cookie-maybe",
            get(|CookieOptionalUser(u): CookieOptionalUser| async move {
                u.map(|u| u.username).unwrap_or_else(|| "anon".into())
            }),
        )
        .with_state(app.state.clone());
    let t = app.token_for(&alice);
    let req = |path: &str, auth: Option<String>, cookie: Option<String>| {
        let mut b = Request::builder().uri(path);
        if let Some(a) = auth {
            b = b.header("authorization", a);
        }
        if let Some(c) = cookie {
            b = b.header("cookie", c);
        }
        b.body(Body::empty()).unwrap()
    };

    assert_eq!(
        call(&router, req("/me", Some(format!("Bearer {t}")), None)).await,
        (StatusCode::OK, alice.username.clone())
    );
    // DRF endpoints: simplejwt's exact scheme, and the ambient cookie is ignored.
    assert_eq!(
        call(&router, req("/me", Some(format!("bearer {t}")), None))
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        call(&router, req("/me", None, Some(format!("a=b; jwt={t}"))))
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        call(&router, req("/maybe", None, Some(format!("jwt={t}")))).await,
        (StatusCode::OK, "anon".into())
    );
    // Media-style endpoints: any-case scheme, else the cookie.
    assert_eq!(
        call(&router, req("/cookie", Some(format!("bearer {t}")), None)).await,
        (StatusCode::OK, alice.username.clone())
    );
    assert_eq!(
        call(&router, req("/cookie", None, Some(format!("a=b; jwt={t}")))).await,
        (StatusCode::OK, alice.username.clone())
    );
    assert_eq!(
        call(&router, req("/cookie-maybe", None, Some("jwt=nope".into()))).await,
        (StatusCode::OK, "anon".into())
    );
    assert_eq!(
        call(
            &router,
            req("/cookie-maybe", Some("Bearer nope".into()), None)
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );
    let (s, body) = call(&router, req("/me", None, None)).await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
    assert!(body.contains("Authentication credentials were not provided."));
    // A bad header token fails even where anonymous is allowed; a bad cookie is anonymous.
    assert_eq!(
        call(&router, req("/maybe", Some("Bearer nope".into()), None))
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        call(&router, req("/maybe", None, Some("jwt=nope".into()))).await,
        (StatusCode::OK, "anon".into())
    );
    assert_eq!(
        call(&router, req("/admin", Some(format!("Bearer {t}")), None))
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    let rt = app.token_for(&root);
    assert_eq!(
        call(&router, req("/admin", Some(format!("Bearer {rt}")), None)).await,
        (StatusCode::OK, root.username.clone())
    );
    app.cleanup().await;
}
