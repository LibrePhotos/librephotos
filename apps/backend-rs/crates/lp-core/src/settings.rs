//! Site settings (formerly constance, `CONSTANCE_CONFIG` in production.py).
//! Stored as `site_settings(key, value jsonb)` with the constance key names;
//! a key without a row takes the env-derived default. Load/save lives in
//! `lp_db::settings`; the live copy is `AppState::settings` (an `ArcSwap`).

use serde::Serialize;
use serde_json::Value;

use crate::config::Config;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct SiteSettings {
    pub allow_registration: bool,
    pub allow_upload: bool,
    pub nextcloud_enabled: bool,
    pub auto_create_user_directory: bool,
    pub skip_patterns: String,
    pub map_api_provider: String,
    pub map_api_key: String,
    pub map_tile_provider: String,
    pub image_dirs: String,
    pub captioning_model: String,
    pub tagging_model: String,
    pub ocr_model: String,
    pub face_recognition_model: String,
    pub log_max_bytes: i64,
    pub log_backup_count: i64,
    pub oidc_enabled: bool,
    pub oidc_button_label: String,
    pub oidc_allow_signup: bool,
}

/// The constance keys, in `CONSTANCE_CONFIG` order.
pub const KEYS: &[&str] = &[
    "ALLOW_REGISTRATION",
    "ALLOW_UPLOAD",
    "NEXTCLOUD_ENABLED",
    "AUTO_CREATE_USER_DIRECTORY",
    "SKIP_PATTERNS",
    "MAP_API_PROVIDER",
    "MAP_API_KEY",
    "MAP_TILE_PROVIDER",
    "IMAGE_DIRS",
    "CAPTIONING_MODEL",
    "TAGGING_MODEL",
    "OCR_MODEL",
    "FACE_RECOGNITION_MODEL",
    "LOG_MAX_BYTES",
    "LOG_BACKUP_COUNT",
    "OIDC_ENABLED",
    "OIDC_BUTTON_LABEL",
    "OIDC_ALLOW_SIGNUP",
];

impl SiteSettings {
    pub fn defaults(config: &Config) -> Self {
        SiteSettings {
            allow_registration: false,
            allow_upload: config.env_allow_upload,
            nextcloud_enabled: config.env_nextcloud_enabled,
            auto_create_user_directory: false,
            skip_patterns: config.env_skip_patterns.clone(),
            map_api_provider: config.env_map_api_provider.clone(),
            map_api_key: config.env_mapbox_api_key.clone(),
            map_tile_provider: config.env_map_tile_provider.clone(),
            image_dirs: "/data".into(),
            captioning_model: "lfm2_vl_450m".into(),
            tagging_model: "mobileclip_s2".into(),
            ocr_model: "None".into(),
            face_recognition_model: "buffalo_sc".into(),
            log_max_bytes: 200 * 1024 * 1024,
            log_backup_count: 10,
            oidc_enabled: false,
            oidc_button_label: "Sign in with SSO".into(),
            oidc_allow_signup: false,
        }
    }

    /// Apply one stored value. Unknown keys and wrong types are ignored
    /// (returns false) so a bad row can't take the site down.
    pub fn apply(&mut self, key: &str, value: &Value) -> bool {
        fn b(v: &Value) -> Option<bool> {
            v.as_bool()
        }
        fn s(v: &Value) -> Option<String> {
            v.as_str().map(str::to_string)
        }
        fn i(v: &Value) -> Option<i64> {
            v.as_i64()
        }
        macro_rules! set {
            ($field:ident, $conv:ident) => {
                match $conv(value) {
                    Some(x) => {
                        self.$field = x;
                        true
                    }
                    None => false,
                }
            };
        }
        match key {
            "ALLOW_REGISTRATION" => set!(allow_registration, b),
            "ALLOW_UPLOAD" => set!(allow_upload, b),
            "NEXTCLOUD_ENABLED" => set!(nextcloud_enabled, b),
            "AUTO_CREATE_USER_DIRECTORY" => set!(auto_create_user_directory, b),
            "SKIP_PATTERNS" => set!(skip_patterns, s),
            "MAP_API_PROVIDER" => set!(map_api_provider, s),
            "MAP_API_KEY" => set!(map_api_key, s),
            "MAP_TILE_PROVIDER" => set!(map_tile_provider, s),
            "IMAGE_DIRS" => set!(image_dirs, s),
            "CAPTIONING_MODEL" => set!(captioning_model, s),
            "TAGGING_MODEL" => set!(tagging_model, s),
            "OCR_MODEL" => set!(ocr_model, s),
            "FACE_RECOGNITION_MODEL" => set!(face_recognition_model, s),
            "LOG_MAX_BYTES" => set!(log_max_bytes, i),
            "LOG_BACKUP_COUNT" => set!(log_backup_count, i),
            "OIDC_ENABLED" => set!(oidc_enabled, b),
            "OIDC_BUTTON_LABEL" => set!(oidc_button_label, s),
            "OIDC_ALLOW_SIGNUP" => set!(oidc_allow_signup, b),
            _ => false,
        }
    }

    pub fn get(&self, key: &str) -> Option<Value> {
        Some(match key {
            "ALLOW_REGISTRATION" => self.allow_registration.into(),
            "ALLOW_UPLOAD" => self.allow_upload.into(),
            "NEXTCLOUD_ENABLED" => self.nextcloud_enabled.into(),
            "AUTO_CREATE_USER_DIRECTORY" => self.auto_create_user_directory.into(),
            "SKIP_PATTERNS" => self.skip_patterns.clone().into(),
            "MAP_API_PROVIDER" => self.map_api_provider.clone().into(),
            "MAP_API_KEY" => self.map_api_key.clone().into(),
            "MAP_TILE_PROVIDER" => self.map_tile_provider.clone().into(),
            "IMAGE_DIRS" => self.image_dirs.clone().into(),
            "CAPTIONING_MODEL" => self.captioning_model.clone().into(),
            "TAGGING_MODEL" => self.tagging_model.clone().into(),
            "OCR_MODEL" => self.ocr_model.clone().into(),
            "FACE_RECOGNITION_MODEL" => self.face_recognition_model.clone().into(),
            "LOG_MAX_BYTES" => self.log_max_bytes.into(),
            "LOG_BACKUP_COUNT" => self.log_backup_count.into(),
            "OIDC_ENABLED" => self.oidc_enabled.into(),
            "OIDC_BUTTON_LABEL" => self.oidc_button_label.clone().into(),
            "OIDC_ALLOW_SIGNUP" => self.oidc_allow_signup.into(),
            _ => return None,
        })
    }
}

/// django-constance 4.x database codec: `{"__type__": "default", "__value__": v}`
/// for JSON-native values. Returns None for undecodable rows (e.g. a pre-4.0
/// pickled value), which the caller skips.
pub fn constance_decode(raw: &str) -> Option<Value> {
    let v: Value = serde_json::from_str(raw).ok()?;
    match &v {
        Value::Object(map) if map.contains_key("__type__") && map.contains_key("__value__") => {
            if map.len() != 2 || map.get("__type__")?.as_str()? != "default" {
                return None;
            }
            map.get("__value__").cloned()
        }
        _ => Some(v),
    }
}

/// Inverse of [`constance_decode`] (Python `json.dumps` default separators).
pub fn constance_encode(value: &Value) -> String {
    let inner = py_json_dumps(value);
    format!("{{\"__type__\": \"default\", \"__value__\": {inner}}}")
}

/// `json.dumps(v)` with Python's default `", "` / `": "` separators and
/// `ensure_ascii=True`.
pub fn py_json_dumps(value: &Value) -> String {
    let mut out = String::new();
    write_py_json(value, &mut out);
    out
}

fn write_py_json(value: &Value, out: &mut String) {
    match value {
        Value::Null => out.push_str("null"),
        Value::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Value::Number(n) => out.push_str(&n.to_string()),
        Value::String(s) => write_py_str(s, out),
        Value::Array(a) => {
            out.push('[');
            for (i, x) in a.iter().enumerate() {
                if i > 0 {
                    out.push_str(", ");
                }
                write_py_json(x, out);
            }
            out.push(']');
        }
        Value::Object(o) => {
            out.push('{');
            for (i, (k, x)) in o.iter().enumerate() {
                if i > 0 {
                    out.push_str(", ");
                }
                write_py_str(k, out);
                out.push_str(": ");
                write_py_json(x, out);
            }
            out.push('}');
        }
    }
}

fn write_py_str(s: &str, out: &mut String) {
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '\u{08}' => out.push_str("\\b"),
            '\u{0c}' => out.push_str("\\f"),
            c if (c as u32) < 0x20 || (c as u32) > 0x7e => {
                let mut buf = [0u16; 2];
                for unit in c.encode_utf16(&mut buf) {
                    out.push_str(&format!("\\u{unit:04x}"));
                }
            }
            c => out.push(c),
        }
    }
    out.push('"');
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn constance_codec() {
        assert_eq!(
            constance_decode(r#"{"__type__": "default", "__value__": false}"#),
            Some(json!(false))
        );
        assert_eq!(
            constance_decode(r#"{"__type__": "default", "__value__": "photon"}"#),
            Some(json!("photon"))
        );
        assert_eq!(
            constance_decode(r#"{"__type__": "datetime", "__value__": "x"}"#),
            None
        );
        assert_eq!(constance_decode("gAJLAS4="), None);
        assert_eq!(
            constance_encode(&json!("a\u{e9}\"")),
            format!(
                "{{\"__type__\": \"default\", \"__value__\": \"a{}u00e9{}\"\"}}",
                '\\', '\\'
            )
        );
        assert_eq!(
            constance_encode(&json!(true)),
            r#"{"__type__": "default", "__value__": true}"#
        );
    }
}
