//! `request.data` for the user endpoints: JSON, multipart (avatar upload) or
//! a urlencoded form, parsed only after authorization like DRF does.

use axum::extract::{FromRequest, Multipart, Request};
use axum::http::StatusCode;
use axum::http::header::CONTENT_TYPE;
use indexmap::IndexMap;
use lp_core::ApiError;
use serde_json::Value;

#[derive(Debug, Clone)]
pub struct UploadedFile {
    pub filename: String,
    pub bytes: bytes::Bytes,
}

#[derive(Debug, Clone)]
pub enum InputValue {
    Value(Value),
    File(UploadedFile),
}

#[derive(Debug, Default)]
pub struct Input {
    pub fields: IndexMap<String, InputValue>,
    /// Form input (multipart / urlencoded): JSON fields arrive as strings.
    pub html: bool,
}

impl Input {
    pub fn get(&self, key: &str) -> Option<&InputValue> {
        self.fields.get(key)
    }
}

fn not_a_dict(v: &Value) -> ApiError {
    let kind = match v {
        Value::Array(_) => "list",
        Value::String(_) => "str",
        Value::Number(n) if n.is_f64() => "float",
        Value::Number(_) => "int",
        Value::Bool(_) => "bool",
        Value::Null => "NoneType",
        Value::Object(_) => "dict",
    };
    ApiError::validation(format!(
        "Invalid data. Expected a dictionary, but got {kind}."
    ))
}

pub async fn read(req: Request) -> Result<Input, ApiError> {
    let ctype = req
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase();
    if ctype.starts_with("multipart/form-data") {
        let mut mp = Multipart::from_request(req, &()).await.map_err(|e| {
            ApiError::bad_request("detail", format!("Multipart form parse error - {e}"))
        })?;
        let mut input = Input {
            html: true,
            ..Default::default()
        };
        loop {
            let field = mp.next_field().await.map_err(|e| {
                ApiError::bad_request("detail", format!("Multipart form parse error - {e}"))
            })?;
            let Some(field) = field else { break };
            let name = field.name().unwrap_or_default().to_string();
            let filename = field.file_name().map(str::to_string);
            let data = field.bytes().await.map_err(|e| {
                ApiError::bad_request("detail", format!("Multipart form parse error - {e}"))
            })?;
            let value = match filename {
                Some(filename) => InputValue::File(UploadedFile {
                    filename,
                    bytes: data,
                }),
                None => {
                    InputValue::Value(Value::String(String::from_utf8_lossy(&data).into_owned()))
                }
            };
            input.fields.insert(name, value);
        }
        return Ok(input);
    }
    let body = axum::body::to_bytes(req.into_body(), 16 * 1024 * 1024)
        .await
        .map_err(|e| ApiError::bad_request("detail", e.to_string()))?;
    if ctype.starts_with("application/x-www-form-urlencoded") {
        let pairs: Vec<(String, String)> = serde_urlencoded::from_bytes(&body).unwrap_or_default();
        let mut input = Input {
            html: true,
            ..Default::default()
        };
        for (k, v) in pairs {
            input.fields.insert(k, InputValue::Value(Value::String(v)));
        }
        return Ok(input);
    }
    if !ctype.is_empty() && !ctype.starts_with("application/json") && !body.is_empty() {
        let shown = ctype.split(';').next().unwrap_or("").trim().to_string();
        return Err(ApiError::new(
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "detail",
            format!("Unsupported media type \"{shown}\" in request."),
        ));
    }
    if body.is_empty() {
        return Ok(Input::default());
    }
    let v: Value = serde_json::from_slice(&body)
        .map_err(|e| ApiError::bad_request("detail", format!("JSON parse error - {e}")))?;
    match v {
        Value::Object(map) => Ok(Input {
            fields: map
                .into_iter()
                .map(|(k, v)| (k, InputValue::Value(v)))
                .collect(),
            html: false,
        }),
        other => Err(not_a_dict(&other)),
    }
}
