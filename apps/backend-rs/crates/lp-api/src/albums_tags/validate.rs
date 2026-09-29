//! DRF field validation for the JSON bodies of this area, with DRF's
//! messages (the UI shows the first one).

use axum::http::StatusCode;
use lp_core::{ApiError, FieldError};
use serde_json::Value;
use uuid::Uuid;

/// Errors of one serializer, in field order.
#[derive(Debug, Default)]
pub struct Errors(pub Vec<FieldError>);

impl Errors {
    pub fn add(&mut self, field: &str, message: impl Into<String>) {
        self.0.push(FieldError {
            field: field.to_string(),
            message: message.into(),
        });
    }

    /// Keep the value, or record the field error.
    pub fn check<T>(&mut self, field: &str, r: Result<T, String>) -> Option<T> {
        match r {
            Ok(v) => Some(v),
            Err(m) => {
                self.add(field, m);
                None
            }
        }
    }

    pub fn into_result(self) -> Result<(), ApiError> {
        if self.0.is_empty() {
            Ok(())
        } else {
            Err(ApiError::fields(StatusCode::BAD_REQUEST, self.0))
        }
    }
}

pub const REQUIRED: &str = "This field is required.";
pub const NULL: &str = "This field may not be null.";

/// Python `type(x).__name__` of a JSON value.
pub fn py_type(v: &Value) -> &'static str {
    match v {
        Value::Null => "NoneType",
        Value::Bool(_) => "bool",
        Value::Number(n) if n.is_f64() => "float",
        Value::Number(_) => "int",
        Value::String(_) => "str",
        Value::Array(_) => "list",
        Value::Object(_) => "dict",
    }
}

/// Python `str(x)` of a JSON scalar.
pub fn py_str(v: &Value) -> String {
    match v {
        Value::Null => "None".into(),
        Value::Bool(true) => "True".into(),
        Value::Bool(false) => "False".into(),
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        other => other.to_string(),
    }
}

/// The request body as a JSON object (DRF: "Invalid data. Expected a
/// dictionary, but got list.").
pub fn body_object(v: &Value) -> Result<&serde_json::Map<String, Value>, ApiError> {
    v.as_object().ok_or_else(|| {
        ApiError::validation(format!(
            "Invalid data. Expected a dictionary, but got {}.",
            py_type(v)
        ))
    })
}

/// `CharField(max_length)` with `trim_whitespace` and no blanks.
pub fn char_field(v: &Value, max_length: usize) -> Result<String, String> {
    let text = match v {
        Value::Null => return Err(NULL.into()),
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        _ => {
            if py_str(v).trim().is_empty() {
                return Err("This field may not be blank.".into());
            }
            return Err("Not a valid string.".into());
        }
    };
    let trimmed = text.trim().to_string();
    if trimmed.is_empty() {
        return Err("This field may not be blank.".into());
    }
    if trimmed.chars().count() > max_length {
        return Err(format!(
            "Ensure this field has no more than {max_length} characters."
        ));
    }
    Ok(trimmed)
}

/// `BooleanField`.
pub fn bool_field(v: &Value) -> Result<bool, String> {
    match v {
        Value::Null => Err(NULL.into()),
        Value::Bool(b) => Ok(*b),
        Value::Number(n) => match n.as_f64() {
            Some(1.0) => Ok(true),
            Some(0.0) => Ok(false),
            _ => Err("Must be a valid boolean.".into()),
        },
        Value::String(s) => match s.as_str() {
            "t" | "T" | "y" | "Y" | "yes" | "Yes" | "YES" | "true" | "True" | "TRUE" | "on"
            | "On" | "ON" | "1" => Ok(true),
            "f" | "F" | "n" | "N" | "no" | "No" | "NO" | "false" | "False" | "FALSE" | "off"
            | "Off" | "OFF" | "0" => Ok(false),
            _ => Err("Must be a valid boolean.".into()),
        },
        _ => Err("Must be a valid boolean.".into()),
    }
}

/// `ListField(child=CharField(max_length))`.
pub fn string_list(v: &Value, max_length: usize) -> Result<Vec<String>, String> {
    let items = match v {
        Value::Null => return Err(NULL.into()),
        Value::Array(items) => items,
        other => {
            return Err(format!(
                "Expected a list of items but got type \"{}\".",
                py_type(other)
            ));
        }
    };
    let mut out = Vec::with_capacity(items.len());
    let mut child_errors: Vec<(usize, String, &'static str)> = Vec::new();
    for (i, item) in items.iter().enumerate() {
        // Children keep blanks out too, except that CharField(default="")
        // children still reject "" (allow_blank is False).
        match char_field(item, max_length) {
            Ok(s) => out.push(s),
            Err(m) => {
                let code = if m == NULL {
                    "null"
                } else if m.starts_with("This field may not be blank") {
                    "blank"
                } else if m.starts_with("Ensure") {
                    "max_length"
                } else {
                    "invalid"
                };
                child_errors.push((i, m, code));
            }
        }
    }
    if child_errors.is_empty() {
        return Ok(out);
    }
    let parts: Vec<String> = child_errors
        .iter()
        .map(|(i, m, code)| format!("{i}: [ErrorDetail(string='{m}', code='{code}')]"))
        .collect();
    Err(format!("{{{}}}", parts.join(", ")))
}

/// `DictField`.
pub fn dict_field(v: &Value) -> Result<Value, String> {
    match v {
        Value::Null => Err(NULL.into()),
        Value::Object(_) => Ok(v.clone()),
        other => Err(format!(
            "Expected a dictionary of items but got type \"{}\".",
            py_type(other)
        )),
    }
}

/// Django `UUIDField.to_python` on a request value (hyphens and braces are
/// ignored, an int is taken as the integer form).
pub fn py_uuid(v: &Value) -> Result<Uuid, String> {
    let invalid = || format!("\u{201c}{}\u{201d} is not a valid UUID.", py_str(v));
    match v {
        Value::Number(n) => match n.as_u64() {
            Some(i) => Ok(Uuid::from_u128(i as u128)),
            None => Err(invalid()),
        },
        Value::String(s) => {
            let mut hex = s.replace("urn:", "").replace("uuid:", "");
            hex = hex.trim_matches(|c| c == '{' || c == '}').replace('-', "");
            if hex.len() != 32 || !hex.chars().all(|c| c.is_ascii_hexdigit()) {
                return Err(invalid());
            }
            Uuid::parse_str(&hex).map_err(|_| invalid())
        }
        _ => Err(invalid()),
    }
}

/// One `OwnedPhotoField` value: `Ok(uuid)` to look up, or the field error.
pub fn photo_pk(v: &Value) -> Result<Uuid, String> {
    if let Value::Bool(_) = v {
        return Err("Incorrect type. Expected pk value, received bool.".into());
    }
    py_uuid(v)
}

pub fn does_not_exist(v: &Value) -> String {
    format!("Invalid pk \"{}\" - object does not exist.", py_str(v))
}

/// `ManyRelatedField` input items (a list; a dict iterates its keys).
pub fn many_items(v: &Value) -> Result<Vec<Value>, String> {
    match v {
        Value::Null => Err(NULL.into()),
        Value::Array(items) => Ok(items.clone()),
        Value::Object(map) => Ok(map.keys().map(|k| Value::String(k.clone())).collect()),
        other => Err(format!(
            "Expected a list of items but got type \"{}\".",
            py_type(other)
        )),
    }
}

/// Django `IntegerField.get_prep_value` (`int(value)`) for ORM lookups;
/// `None` means Python would raise (a 500 in the views that do this).
pub fn py_int(v: &Value) -> Option<i64> {
    match v {
        Value::Bool(b) => Some(*b as i64),
        Value::Number(n) => n.as_i64().or_else(|| n.as_f64().map(|f| f.trunc() as i64)),
        Value::String(s) => s.trim().parse().ok(),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn fields() {
        assert_eq!(char_field(&json!("  a "), 5).unwrap(), "a");
        assert!(char_field(&json!("  "), 5).unwrap_err().contains("blank"));
        assert_eq!(
            char_field(&json!(true), 5).unwrap_err(),
            "Not a valid string."
        );
        assert!(bool_field(&json!("maybe")).is_err());
        assert!(bool_field(&json!("yes")).unwrap());
        assert_eq!(
            string_list(&json!([{}]), 100).unwrap_err(),
            "{0: [ErrorDetail(string='Not a valid string.', code='invalid')]}"
        );
        assert_eq!(
            py_uuid(&json!("abc")).unwrap_err(),
            "\u{201c}abc\u{201d} is not a valid UUID."
        );
        assert!(py_uuid(&json!("{853CC5B1-8c82-4daf-8254-049e7cf1829a}")).is_ok());
        assert_eq!(py_int(&json!("3")), Some(3));
        assert_eq!(py_int(&json!("x")), None);
    }
}
