//! The Nextcloud WebDAV client against in-test servers on ephemeral ports:
//! the app password never follows a redirect to another origin (`requests`'
//! `should_strip_auth`, which Django's pyocclient client runs on), and a
//! listing that names a directory again (or nests without end) is not
//! walked forever.

use std::sync::{Arc, Mutex};

use axum::Router;
use axum::http::{HeaderMap, Method, StatusCode, header};
use axum::response::{IntoResponse, Response};
use lp_tasks::nextcloud::{Dav, collect_photos};

type Seen = Arc<Mutex<Vec<(u16, String, Option<String>)>>>;

fn multistatus(entries: &[(&str, bool)]) -> String {
    let mut body = String::from(r#"<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">"#);
    for (href, is_dir) in entries {
        let rt = if *is_dir {
            "<d:resourcetype><d:collection/></d:resourcetype>".to_string()
        } else {
            "<d:resourcetype/><d:getcontenttype>image/jpeg</d:getcontenttype>".to_string()
        };
        body.push_str(&format!(
            "<d:response><d:href>{href}</d:href><d:propstat><d:prop>{rt}</d:prop>\
             </d:propstat></d:response>"
        ));
    }
    body.push_str("</d:multistatus>");
    body
}

async fn start(
    seen: Seen,
    handler: impl Fn(u16, &str) -> Response + Clone + Send + Sync + 'static,
) -> u16 {
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
        .await
        .unwrap();
    let port = listener.local_addr().unwrap().port();
    let app = Router::new().fallback(
        move |method: Method, uri: axum::http::Uri, headers: HeaderMap| {
            let (seen, handler) = (seen.clone(), handler.clone());
            async move {
                let auth = headers
                    .get(header::AUTHORIZATION)
                    .and_then(|h| h.to_str().ok())
                    .map(str::to_string);
                seen.lock()
                    .unwrap()
                    .push((port, format!("{method} {}", uri.path()), auth));
                handler(port, uri.path())
            }
        },
    );
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    port
}

fn redirect(to: String) -> Response {
    (StatusCode::TEMPORARY_REDIRECT, [(header::LOCATION, to)]).into_response()
}

fn listing(body: String) -> Response {
    (
        StatusCode::MULTI_STATUS,
        [(header::CONTENT_TYPE, "application/xml")],
        body,
    )
        .into_response()
}

#[tokio::test]
async fn redirects_keep_credentials_on_the_origin_and_listings_cannot_loop() {
    // SAFETY: set before anything in this binary reads it.
    unsafe { std::env::set_var("LP_NEXTCLOUD_TEST_ALLOW_LOOPBACK", "1") };
    let seen: Seen = Arc::default();

    // B: another origin (different port) that records what it receives.
    let port_b = start(seen.clone(), |_, _| {
        listing(multistatus(&[("/remote.php/webdav/Moved/", true)]))
    })
    .await;
    // A: `/Same` moves within the origin, `/Away` to B, `/Loop` lists
    // itself and its parent as subdirectories.
    let port_a = start(seen.clone(), move |port, path| match path {
        "/remote.php/webdav/Same" => {
            redirect(format!("http://127.0.0.1:{port}/remote.php/webdav/Same2"))
        }
        "/remote.php/webdav/Away" => {
            redirect(format!("http://127.0.0.1:{port_b}/remote.php/webdav/Moved"))
        }
        "/remote.php/webdav/Loop" | "/remote.php/webdav/Loop/" => listing(multistatus(&[
            ("/remote.php/webdav/Loop/", true),
            ("/remote.php/webdav/Loop/", true),
            ("/remote.php/webdav/Loop/Sub/", true),
            ("/remote.php/webdav/Loop/a.jpg", false),
        ])),
        "/remote.php/webdav/Loop/Sub" | "/remote.php/webdav/Loop/Sub/" => listing(multistatus(&[
            ("/remote.php/webdav/Loop/Sub/", true),
            ("/remote.php/webdav/Loop/", true),
            ("/remote.php/webdav/Loop/Sub/b.jpg", false),
        ])),
        // Every folder holds a deeper one, without end.
        p if p.starts_with("/remote.php/webdav/Deep") => {
            let own = format!("{}/", p.trim_end_matches('/'));
            let child = format!("{own}d/");
            listing(multistatus(&[(own.as_str(), true), (child.as_str(), true)]))
        }
        _ => listing(multistatus(&[("/remote.php/webdav/x/", true)])),
    })
    .await;
    let dav = Dav::new(&format!("http://127.0.0.1:{port_a}"), "ncuser", "ncpass");

    dav.list("/Same").await.unwrap();
    dav.list("/Away").await.unwrap();
    let log = seen.lock().unwrap().clone();
    let auth_of = |port: u16, what: &str| {
        log.iter()
            .find(|(p, w, _)| *p == port && w == what)
            .unwrap_or_else(|| panic!("{what} on {port} never arrived: {log:?}"))
            .2
            .clone()
    };
    assert!(auth_of(port_a, "PROPFIND /remote.php/webdav/Same2").is_some());
    assert!(auth_of(port_a, "PROPFIND /remote.php/webdav/Away").is_some());
    assert_eq!(
        auth_of(port_b, "PROPFIND /remote.php/webdav/Moved"),
        None,
        "the app password followed a redirect to another origin"
    );

    let photos = tokio::time::timeout(
        std::time::Duration::from_secs(30),
        collect_photos(&dav, "/Loop"),
    )
    .await
    .expect("the self-referencing listing was walked forever")
    .unwrap();
    assert_eq!(photos, vec!["/Loop/a.jpg", "/Loop/Sub/b.jpg"]);

    let deep = tokio::time::timeout(
        std::time::Duration::from_secs(60),
        collect_photos(&dav, "/Deep"),
    )
    .await
    .expect("the endless folder chain was walked forever");
    assert!(
        matches!(deep, Err(lp_tasks::nextcloud::DavError::TooDeep(_))),
        "{deep:?}"
    );
}

#[test]
fn strip_auth_matches_requests() {
    // Expected values from requests 2.x `Session.should_strip_auth`.
    use lp_tasks::nextcloud::should_strip_auth;
    let u = |s: &str| reqwest::Url::parse(s).unwrap();
    let cases = [
        ("http://h/a", "http://h/b", false),
        ("http://h/a", "http://h:80/b", false),
        ("http://h/a", "https://h/b", false),
        ("https://h/a", "http://h/b", true),
        ("http://h/a", "http://h:8080/b", true),
        ("http://h/a", "http://other/b", true),
        ("https://h:8443/a", "https://h:8443/b", false),
        ("http://h:80/a", "https://h:443/b", false),
        ("https://h/a", "https://h:443/b", false),
    ];
    for (old, new, strip) in cases {
        assert_eq!(should_strip_auth(&u(old), &u(new)), strip, "{old} -> {new}");
    }
}
