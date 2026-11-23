//! DRF field validation for the user serializers (`rest_framework.fields`):
//! same accepted inputs, same coercions, same error messages.

use std::sync::OnceLock;

use lp_core::{ApiError, FieldError};
use regex::Regex;
use serde_json::Value;

#[derive(Debug, Clone, Copy)]
pub enum Kind {
    /// `CharField(max_length, allow_blank)` (+ `min_length`).
    Char {
        max: usize,
        min: usize,
        allow_blank: bool,
    },
    /// `username`: not blank, max 150, `UnicodeUsernameValidator`.
    Username,
    /// Model `EmailField(blank=True)`: max 254, `EmailValidator`.
    Email,
    /// Model `IntegerField` (32-bit bounds).
    Int,
    Float,
    Bool,
    Choice(&'static [&'static str]),
    /// `default_timezone`: a choice among `pytz.all_timezones`.
    Timezone,
    Json,
    DateTime {
        allow_null: bool,
    },
}

#[derive(Debug, Clone, PartialEq)]
pub enum Parsed {
    Str(String),
    Int(i32),
    Float(f64),
    Bool(bool),
    Json(Value),
    /// A datetime that was only validated (never written).
    DateTime,
    Null,
}

impl Parsed {
    pub fn as_str(&self) -> Option<&str> {
        match self {
            Parsed::Str(s) => Some(s),
            _ => None,
        }
    }
}

pub const SAVE_METADATA: &[&str] = &["OFF", "MEDIA_FILE", "SIDECAR_FILE"];
pub const TEXT_ALIGNMENT: &[&str] = &["left", "right"];
pub const HEADER_SIZE: &[&str] = &["large", "normal", "small"];
pub const DUPLICATE_SENSITIVITY: &[&str] = &["strict", "normal", "loose"];

/// `pytz.all_timezones` (the `default_timezone` choices), from the same data
/// `/api/timezones/` serves.
pub fn timezones() -> &'static [String] {
    static TZ: OnceLock<Vec<String>> = OnceLock::new();
    TZ.get_or_init(|| {
        serde_json::from_str(super::static_data::TIMEZONES).expect("bundled timezones")
    })
}

/// Python `str()` of a JSON scalar, for messages and `CharField` coercion.
fn py_str(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Bool(true) => "True".into(),
        Value::Bool(false) => "False".into(),
        Value::Null => "None".into(),
        Value::Number(n) => n.to_string(),
        other => other.to_string(),
    }
}

fn username_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^[\w.@+-]+$").expect("regex"))
}

pub const USERNAME_INVALID: &str = "Enter a valid username. This value may contain only letters, numbers, and @/./+/-/_ characters.";

/// Django's `EmailValidator` (unquoted local parts; domains, `localhost`, IP literals).
pub fn is_valid_email(value: &str) -> bool {
    static USER: OnceLock<Regex> = OnceLock::new();
    static DOMAIN: OnceLock<Regex> = OnceLock::new();
    static LITERAL: OnceLock<Regex> = OnceLock::new();
    static QUOTED: OnceLock<Regex> = OnceLock::new();
    if value.is_empty() || value.chars().count() > 320 {
        return false;
    }
    let Some((user, domain)) = value.rsplit_once('@') else {
        return false;
    };
    let user_re = USER.get_or_init(|| {
        Regex::new(r"(?i)^[-!#$%&'*+/=?^_`{}|~0-9A-Z]+(\.[-!#$%&'*+/=?^_`{}|~0-9A-Z]+)*$")
            .expect("regex")
    });
    let quoted_re = QUOTED.get_or_init(|| {
        Regex::new(
            r#"(?i)^"([\x01-\x08\x0b\x0c\x0e-\x1f!#-\[\]-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])*"$"#,
        )
        .expect("regex")
    });
    if !user_re.is_match(user) && !quoted_re.is_match(user) {
        return false;
    }
    if domain == "localhost" {
        return true;
    }
    let domain_re = DOMAIN.get_or_init(|| {
        Regex::new(r"(?i)^((?:[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?\.)+)(?:[A-Z0-9-]{2,63})$")
            .expect("regex")
    });
    if domain_re.is_match(domain) && !domain.ends_with('-') {
        return true;
    }
    // Django retries with the IDNA-encoded domain; non-ASCII labels pass as
    // long as their shape is a hostname.
    if !domain.is_ascii() {
        let ascii: String = domain
            .chars()
            .map(|c| if c.is_ascii() { c } else { 'x' })
            .collect();
        if domain_re.is_match(&ascii) && !ascii.ends_with('-') {
            return true;
        }
    }
    let literal = LITERAL.get_or_init(|| Regex::new(r"^\[(.+)\]$").expect("regex"));
    if let Some(c) = literal.captures(domain) {
        let inner = &c[1];
        let inner = inner.strip_prefix("IPv6:").unwrap_or(inner);
        return inner.parse::<std::net::IpAddr>().is_ok();
    }
    false
}

/// Validate one input value like the DRF field would (`run_validation`).
/// Messages come back in DRF order; the caller joins them with a space.
pub fn parse(kind: Kind, v: &Value) -> Result<Parsed, Vec<String>> {
    let one = |m: &str| Err(vec![m.to_string()]);
    match kind {
        Kind::Char {
            max,
            min,
            allow_blank,
        } => parse_char(v, max, min, allow_blank),
        Kind::Username => {
            let parsed = parse_char(v, 150, 0, false)?;
            let s = parsed.as_str().unwrap_or_default().to_string();
            let mut errs = Vec::new();
            if !username_re().is_match(&s) {
                errs.push(USERNAME_INVALID.to_string());
            }
            if !errs.is_empty() {
                return Err(errs);
            }
            Ok(parsed)
        }
        Kind::Email => {
            let parsed = parse_char(v, 254, 0, true)?;
            let s = parsed.as_str().unwrap_or_default();
            if !s.is_empty() && !is_valid_email(s) {
                return one("Enter a valid email address.");
            }
            Ok(parsed)
        }
        Kind::Int => {
            if v.is_null() {
                return one("This field may not be null.");
            }
            if let Value::String(s) = v
                && s.chars().count() > 1000
            {
                return one("String value too large.");
            }
            if v.is_boolean() || v.is_array() || v.is_object() {
                return one("A valid integer is required.");
            }
            let text = py_str(v);
            let stripped = strip_decimal_zeros(&text);
            let n: i64 = match stripped.trim().replace('_', "").parse::<i64>() {
                Ok(n) => n,
                Err(_) => return one("A valid integer is required."),
            };
            if n > i32::MAX as i64 {
                return one("Ensure this value is less than or equal to 2147483647.");
            }
            if n < i32::MIN as i64 {
                return one("Ensure this value is greater than or equal to -2147483648.");
            }
            Ok(Parsed::Int(n as i32))
        }
        Kind::Float => match v {
            Value::Null => one("This field may not be null."),
            Value::Bool(b) => Ok(Parsed::Float(if *b { 1.0 } else { 0.0 })),
            Value::Number(n) => Ok(Parsed::Float(n.as_f64().unwrap_or(0.0))),
            Value::String(s) if s.chars().count() > 1000 => one("String value too large."),
            Value::String(s) => match s.trim().replace('_', "").parse::<f64>() {
                Ok(f) => Ok(Parsed::Float(f)),
                Err(_) => one("A valid number is required."),
            },
            _ => one("A valid number is required."),
        },
        Kind::Bool => {
            let truthy = match v {
                Value::Bool(b) => Some(*b),
                Value::Number(n) => match n.as_f64() {
                    Some(1.0) => Some(true),
                    Some(0.0) => Some(false),
                    _ => None,
                },
                Value::String(s) => match s.to_lowercase().as_str() {
                    "t" | "y" | "yes" | "true" | "on" | "1" => Some(true),
                    "f" | "n" | "no" | "false" | "off" | "0" => Some(false),
                    _ => None,
                },
                _ => None,
            };
            match truthy {
                Some(b) => Ok(Parsed::Bool(b)),
                None if v.is_null() => one("This field may not be null."),
                None => one("Must be a valid boolean."),
            }
        }
        Kind::Choice(choices) => {
            if v.is_null() {
                return one("This field may not be null.");
            }
            let s = py_str(v);
            if choices.contains(&s.as_str()) {
                Ok(Parsed::Str(s))
            } else {
                Err(vec![format!("\"{s}\" is not a valid choice.")])
            }
        }
        Kind::Timezone => {
            if v.is_null() {
                return one("This field may not be null.");
            }
            let s = py_str(v);
            if timezones().contains(&s) {
                Ok(Parsed::Str(s))
            } else {
                Err(vec![format!("\"{s}\" is not a valid choice.")])
            }
        }
        Kind::Json if v.is_null() => one("This field may not be null."),
        Kind::Json => Ok(Parsed::Json(v.clone())),
        Kind::DateTime { allow_null } => match v {
            Value::Null if allow_null => Ok(Parsed::Null),
            Value::Null => one("This field may not be null."),
            Value::String(s) if lp_core::time::parse_client_datetime(s).is_some() => {
                Ok(Parsed::DateTime)
            }
            _ => one(
                "Datetime has wrong format. Use one of these formats instead: \
                 YYYY-MM-DDThh:mm[:ss[.uuuuuu]][+HH:MM|-HH:MM|Z].",
            ),
        },
    }
}

/// DRF `IntegerField.re_decimal`: `\.0*\s*$` removed before `int()`.
fn strip_decimal_zeros(s: &str) -> &str {
    let t = s.trim_end();
    if let Some(dot) = t.rfind('.')
        && t[dot + 1..].chars().all(|c| c == '0')
    {
        return &t[..dot];
    }
    s
}

fn parse_char(v: &Value, max: usize, min: usize, allow_blank: bool) -> Result<Parsed, Vec<String>> {
    let blank = match v {
        Value::String(s) => s.trim().is_empty(),
        _ => false,
    };
    if blank {
        if !allow_blank {
            return Err(vec!["This field may not be blank.".into()]);
        }
        return Ok(Parsed::Str(String::new()));
    }
    match v {
        Value::Null => return Err(vec!["This field may not be null.".into()]),
        Value::String(_) | Value::Number(_) => {}
        _ => return Err(vec!["Not a valid string.".into()]),
    }
    let s = py_str(v).trim().to_string();
    let mut errs = Vec::new();
    let len = s.chars().count();
    if len > max {
        errs.push(format!(
            "Ensure this field has no more than {max} characters."
        ));
    }
    if len < min {
        errs.push(format!("Ensure this field has at least {min} characters."));
    }
    if s.contains('\0') {
        errs.push("Null characters are not allowed.".into());
    }
    if errs.is_empty() {
        Ok(Parsed::Str(s))
    } else {
        Err(errs)
    }
}

/// Collects per-field errors in serializer field order.
#[derive(Default)]
pub struct Errors(pub Vec<FieldError>);

impl Errors {
    pub fn add(&mut self, field: &str, messages: Vec<String>) {
        self.0.push(FieldError {
            field: field.to_string(),
            message: messages.join(" "),
        });
    }

    pub fn into_result(self) -> Result<(), ApiError> {
        if self.0.is_empty() {
            Ok(())
        } else {
            Err(ApiError::fields(
                axum::http::StatusCode::BAD_REQUEST,
                self.0,
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn drf_coercions() {
        assert_eq!(parse(Kind::Int, &json!("5.00")), Ok(Parsed::Int(5)));
        assert_eq!(parse(Kind::Int, &json!(7.0)), Ok(Parsed::Int(7)));
        assert!(parse(Kind::Int, &json!(7.5)).is_err());
        assert!(parse(Kind::Int, &json!(true)).is_err());
        assert_eq!(parse(Kind::Float, &json!("0.25")), Ok(Parsed::Float(0.25)));
        assert_eq!(parse(Kind::Bool, &json!("On")), Ok(Parsed::Bool(true)));
        assert_eq!(parse(Kind::Bool, &json!(0)), Ok(Parsed::Bool(false)));
        assert!(parse(Kind::Bool, &json!("maybe")).is_err());
        assert_eq!(
            parse(
                Kind::Char {
                    max: 5,
                    min: 0,
                    allow_blank: true
                },
                &json!(" ab ")
            ),
            Ok(Parsed::Str("ab".into()))
        );
        assert!(
            parse(
                Kind::Char {
                    max: 5,
                    min: 0,
                    allow_blank: true
                },
                &json!(true)
            )
            .is_err()
        );
        assert_eq!(
            parse(Kind::Choice(HEADER_SIZE), &json!("huge")),
            Err(vec!["\"huge\" is not a valid choice.".to_string()])
        );
    }

    #[test]
    fn emails() {
        assert!(is_valid_email("alice@fixture.invalid"));
        assert!(is_valid_email("a.b+c@localhost"));
        assert!(is_valid_email("x@[127.0.0.1]"));
        assert!(!is_valid_email("no-at-sign"));
        assert!(!is_valid_email("a@b"));
        assert!(!is_valid_email("a b@c.de"));
    }

    #[test]
    fn usernames() {
        assert!(parse(Kind::Username, &json!("alice.b+c@x-y_z")).is_ok());
        assert!(parse(Kind::Username, &json!("Ünïcode")).is_ok());
        assert!(parse(Kind::Username, &json!("with space")).is_err());
        assert!(parse(Kind::Username, &json!("")).is_err());
    }
}
