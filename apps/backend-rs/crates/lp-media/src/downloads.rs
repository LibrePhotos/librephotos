//! `GET /api/downloads/{uuid}{userId}`: a finished zip download. Behind
//! nginx this is `try_files /protected_media/zip/$1.zip`, unauthenticated;
//! here it is served (or handed to nginx) only to the user whose id ends
//! the name, so native dev works without nginx.

use axum::extract::{Path as UrlPath, State};
use axum::http::{HeaderMap, Method, StatusCode};
use axum::response::Response;
use lp_auth::CookieUser;
use lp_core::AppState;

use crate::serve::{FileRequest, empty, x_accel};
use crate::view::{Ctx, zip_file_name};

pub async fn download(
    State(state): State<AppState>,
    user: CookieUser,
    method: Method,
    headers: HeaderMap,
    UrlPath(name): UrlPath<String>,
) -> Response {
    let filename = name
        .get(..36)
        .filter(|_| name.get(36..) == Some(user.id.to_string().as_str()))
        .and_then(|uuid| zip_file_name(uuid, user.id));
    let Some(filename) = filename else {
        return empty(StatusCode::NOT_FOUND);
    };
    let ctx = Ctx::new(&state, &method, &headers);
    if ctx.proxy {
        return x_accel(
            "application/x-zip-compressed",
            &format!("/protected_media/zip/{filename}"),
        );
    }
    let dir = state.config.zip_dir();
    ctx_file(
        &ctx,
        FileRequest::new(
            dir.join(&filename),
            dir,
            Some("application/x-zip-compressed"),
        ),
    )
    .await
}

async fn ctx_file(ctx: &Ctx, req: FileRequest) -> Response {
    crate::serve::serve_file(req, ctx.range.clone(), ctx.head).await
}
