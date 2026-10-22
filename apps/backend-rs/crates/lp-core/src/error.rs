//! The DRF error envelope (`api/views/exception_handler.py`):
//! `{"errors": [{"field": ..., "message": ...}]}`. The UI shows the first
//! `message`; auth failures use the field `detail`.

use axum::Json;
use axum::http::{HeaderName, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use serde::Serialize;

pub type ApiResult<T> = Result<T, ApiError>;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct FieldError {
    pub field: String,
    pub message: String,
}

#[derive(Debug)]
pub struct ApiError {
    pub status: StatusCode,
    pub errors: Vec<FieldError>,
    pub headers: Vec<(HeaderName, HeaderValue)>,
    /// Replaces the envelope entirely (e.g. media refusals with an empty body).
    pub empty_body: bool,
}

#[derive(Serialize)]
struct Envelope<'a> {
    errors: &'a [FieldError],
}

impl ApiError {
    pub fn new(status: StatusCode, field: impl Into<String>, message: impl Into<String>) -> Self {
        ApiError {
            status,
            errors: vec![FieldError {
                field: field.into(),
                message: message.into(),
            }],
            headers: Vec::new(),
            empty_body: false,
        }
    }

    /// Several field errors at once (DRF serializer validation).
    pub fn fields(status: StatusCode, errors: Vec<FieldError>) -> Self {
        ApiError {
            status,
            errors,
            headers: Vec::new(),
            empty_body: false,
        }
    }

    /// Bare status, no body.
    pub fn status_only(status: StatusCode) -> Self {
        ApiError {
            status,
            errors: Vec::new(),
            headers: Vec::new(),
            empty_body: true,
        }
    }

    pub fn with_header(mut self, name: HeaderName, value: HeaderValue) -> Self {
        self.headers.push((name, value));
        self
    }

    /// 400 on a named field.
    pub fn bad_request(field: impl Into<String>, message: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_REQUEST, field, message)
    }

    /// 400 like DRF's `ValidationError("...")` raised with a plain string.
    pub fn validation(message: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_REQUEST, "non_field_errors", message)
    }

    /// 401 with field `detail`, plus DRF's `WWW-Authenticate` challenge.
    pub fn unauthorized(message: impl Into<String>) -> Self {
        Self::new(StatusCode::UNAUTHORIZED, "detail", message).with_header(
            axum::http::header::WWW_AUTHENTICATE,
            HeaderValue::from_static("Bearer realm=\"api\""),
        )
    }

    /// DRF `NotAuthenticated`.
    pub fn not_authenticated() -> Self {
        Self::unauthorized("Authentication credentials were not provided.")
    }

    /// 403 with field `detail`.
    pub fn forbidden(message: impl Into<String>) -> Self {
        Self::new(StatusCode::FORBIDDEN, "detail", message)
    }

    /// DRF `PermissionDenied` default text.
    pub fn permission_denied() -> Self {
        Self::forbidden("You do not have permission to perform this action.")
    }

    /// 404 `{"errors":[{"field":"detail","message":"Not found."}]}`.
    pub fn not_found() -> Self {
        Self::new(StatusCode::NOT_FOUND, "detail", "Not found.")
    }

    pub fn not_found_msg(message: impl Into<String>) -> Self {
        Self::new(StatusCode::NOT_FOUND, "detail", message)
    }

    /// 500; the cause is logged, never sent (the UI never shows a 500 body).
    pub fn internal(err: impl std::fmt::Display) -> Self {
        tracing::error!(error = %err, "internal error");
        Self::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "detail",
            "A server error occurred.",
        )
    }

    pub fn first_message(&self) -> Option<&str> {
        self.errors.first().map(|e| e.message.as_str())
    }
}

impl std::fmt::Display for ApiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.status)?;
        for e in &self.errors {
            write!(f, " [{}: {}]", e.field, e.message)?;
        }
        Ok(())
    }
}

impl std::error::Error for ApiError {}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let mut resp = if self.empty_body {
            self.status.into_response()
        } else {
            (
                self.status,
                Json(Envelope {
                    errors: &self.errors,
                }),
            )
                .into_response()
        };
        for (k, v) in self.headers {
            resp.headers_mut().append(k, v);
        }
        resp
    }
}

impl From<sqlx::Error> for ApiError {
    fn from(e: sqlx::Error) -> Self {
        match e {
            sqlx::Error::RowNotFound => ApiError::not_found(),
            other => ApiError::internal(other),
        }
    }
}

impl From<anyhow::Error> for ApiError {
    fn from(e: anyhow::Error) -> Self {
        match e.downcast::<ApiError>() {
            Ok(api) => api,
            Err(e) => ApiError::internal(format!("{e:#}")),
        }
    }
}

impl From<std::io::Error> for ApiError {
    fn from(e: std::io::Error) -> Self {
        ApiError::internal(e)
    }
}

impl From<serde_json::Error> for ApiError {
    fn from(e: serde_json::Error) -> Self {
        ApiError::internal(e)
    }
}

impl From<tokio::task::JoinError> for ApiError {
    fn from(e: tokio::task::JoinError) -> Self {
        ApiError::internal(e)
    }
}
