//! Correctness guard: every measured response is checked, a wrong answer is a failure.

use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Clone, Deserialize, Default)]
pub struct Check {
    #[serde(default = "ok")]
    pub status: u16,
    /// JSON pointer -> expected array length (or object key count).
    #[serde(default)]
    pub len: Vec<(String, usize)>,
    /// JSON pointer -> expected value.
    #[serde(default)]
    pub eq: Vec<(String, Value)>,
    /// Exact body length (media).
    #[serde(default)]
    pub bytes: Option<usize>,
    /// Minimum body length.
    #[serde(default)]
    pub min_bytes: Option<usize>,
}

fn ok() -> u16 {
    200
}

impl Check {
    pub fn needs_json(&self) -> bool {
        !self.len.is_empty() || !self.eq.is_empty()
    }

    pub fn verify(&self, status: u16, body: &[u8]) -> Result<(), String> {
        if status != self.status {
            return Err(format!("status {status}"));
        }
        if let Some(n) = self.bytes {
            if body.len() != n {
                return Err(format!("bytes {} != {n}", body.len()));
            }
        }
        if let Some(n) = self.min_bytes {
            if body.len() < n {
                return Err(format!("bytes {} < {n}", body.len()));
            }
        }
        if !self.needs_json() {
            return Ok(());
        }
        let v: Value = serde_json::from_slice(body).map_err(|e| format!("json: {e}"))?;
        for (ptr, n) in &self.len {
            let got = match v.pointer(ptr) {
                Some(Value::Array(a)) => a.len(),
                Some(Value::Object(o)) => o.len(),
                other => return Err(format!("{ptr}: not a collection ({})", short(other))),
            };
            if got != *n {
                return Err(format!("{ptr}: len {got} != {n}"));
            }
        }
        for (ptr, want) in &self.eq {
            let got = v.pointer(ptr);
            if !same(got, want) {
                return Err(format!("{ptr}: {} != {want}", short(got)));
            }
        }
        Ok(())
    }
}

/// Numbers compare numerically ("5" and 5 are not equal, 5 and 5.0 are).
fn same(got: Option<&Value>, want: &Value) -> bool {
    match (got, want) {
        (Some(Value::Number(a)), Value::Number(b)) => a.as_f64() == b.as_f64(),
        (Some(g), w) => g == w,
        (None, Value::Null) => true,
        (None, _) => false,
    }
}

fn short(v: Option<&Value>) -> String {
    match v {
        None => "<missing>".into(),
        Some(v) => {
            let s = v.to_string();
            s.chars().take(60).collect()
        }
    }
}
