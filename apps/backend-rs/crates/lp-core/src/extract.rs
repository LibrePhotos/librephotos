//! Request extractors whose rejections use the error envelope.

use axum::extract::{FromRequest, FromRequestParts, Request};
use axum::http::request::Parts;
use serde::de::DeserializeOwned;

use crate::error::ApiError;

/// Query string as Django's `request.query_params`: repeated keys allowed,
/// `get` returns the LAST value (QueryDict semantics).
#[derive(Debug, Clone, Default)]
pub struct QueryMap(pub Vec<(String, String)>);

impl QueryMap {
    pub fn parse(query: Option<&str>) -> Self {
        QueryMap(
            query
                .map(|q| {
                    form_urlencoded_pairs(q)
                        .into_iter()
                        .collect::<Vec<(String, String)>>()
                })
                .unwrap_or_default(),
        )
    }

    pub fn get(&self, key: &str) -> Option<&str> {
        self.0
            .iter()
            .rev()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.as_str())
    }

    pub fn get_all<'a>(&'a self, key: &'a str) -> impl Iterator<Item = &'a str> + 'a {
        self.0
            .iter()
            .filter(move |(k, _)| k == key)
            .map(|(_, v)| v.as_str())
    }

    /// Django's `if request.query_params.get(name):` — any non-empty value
    /// (including `"false"` and `"0"`) is true.
    pub fn flag(&self, key: &str) -> bool {
        self.get(key).is_some_and(|v| !v.is_empty())
    }

    /// Non-empty value, else None.
    pub fn non_empty(&self, key: &str) -> Option<&str> {
        self.get(key).filter(|v| !v.is_empty())
    }

    pub fn int(&self, key: &str) -> Option<i64> {
        self.non_empty(key).and_then(|v| v.trim().parse().ok())
    }
}

fn form_urlencoded_pairs(q: &str) -> Vec<(String, String)> {
    serde_urlencoded::from_str::<Vec<(String, String)>>(q).unwrap_or_default()
}

impl<S: Send + Sync> FromRequestParts<S> for QueryMap {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        Ok(QueryMap::parse(parts.uri.query()))
    }
}

/// Typed query string; a parse failure is a 400 envelope.
pub struct ApiQuery<T>(pub T);

impl<S: Send + Sync, T: DeserializeOwned> FromRequestParts<S> for ApiQuery<T> {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        let q = parts.uri.query().unwrap_or("");
        serde_urlencoded::from_str(q)
            .map(ApiQuery)
            .map_err(|e| ApiError::bad_request("detail", e.to_string()))
    }
}

/// JSON body; malformed JSON is a 400 `detail` like DRF's `ParseError`.
/// Unlike axum's `Json`, a missing `Content-Type` is tolerated.
pub struct ApiJson<T>(pub T);

impl<S: Send + Sync, T: DeserializeOwned> FromRequest<S> for ApiJson<T> {
    type Rejection = ApiError;

    async fn from_request(req: Request, state: &S) -> Result<Self, Self::Rejection> {
        let bytes = axum::body::Bytes::from_request(req, state)
            .await
            .map_err(|e| ApiError::bad_request("detail", e.to_string()))?;
        let body: &[u8] = if bytes.is_empty() { b"{}" } else { &bytes };
        serde_json::from_slice(body)
            .map(ApiJson)
            .map_err(|e| ApiError::bad_request("detail", format!("JSON parse error - {e}")))
    }
}

/// Python truthiness of a JSON value (`if params.get("x"):` on a parsed body).
pub fn py_truthy(v: &serde_json::Value) -> bool {
    use serde_json::Value;
    match v {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().is_some_and(|f| f != 0.0),
        Value::String(s) => !s.is_empty(),
        Value::Array(a) => !a.is_empty(),
        Value::Object(o) => !o.is_empty(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn query_map_semantics() {
        let q = QueryMap::parse(Some("a=1&a=2&b=&c=false&d=%2Fx%20y"));
        assert_eq!(q.get("a"), Some("2"));
        assert!(!q.flag("b"));
        assert!(q.flag("c"));
        assert!(!q.flag("missing"));
        assert_eq!(q.get("d"), Some("/x y"));
        assert_eq!(q.int("a"), Some(2));
    }

    #[test]
    fn truthy() {
        assert!(py_truthy(&serde_json::json!("x")));
        assert!(!py_truthy(&serde_json::json!("")));
        assert!(!py_truthy(&serde_json::json!(0)));
        assert!(py_truthy(&serde_json::json!(true)));
    }
}
