//! Python value formatting where Django stores `str(value)` of something
//! ExifTool returned (`video_length`, `date_taken_subsec`, shutter speed
//! fractions) or writes a `repr` into a job error.

use serde_json::Value;

/// `repr(float)`: shortest round-trip digits, `1e-05` / `1e+16` outside
/// `1e-4 <= |x| < 1e16`, a trailing `.0` for integral values.
pub fn float_repr(x: f64) -> String {
    if x.is_nan() {
        return "nan".into();
    }
    if x.is_infinite() {
        return if x > 0.0 { "inf".into() } else { "-inf".into() };
    }
    if x == 0.0 {
        return if x.is_sign_negative() {
            "-0.0".into()
        } else {
            "0.0".into()
        };
    }
    let sci = format!("{x:e}");
    let (mantissa, exp) = sci.split_once('e').expect("{:e} has an exponent");
    let exp: i32 = exp.parse().expect("exponent");
    let neg = mantissa.starts_with('-');
    let digits: String = mantissa.chars().filter(|c| c.is_ascii_digit()).collect();
    let sign = if neg { "-" } else { "" };
    if !(-4..16).contains(&exp) {
        let mut m = digits[..1].to_string();
        if digits.len() > 1 {
            m.push('.');
            m.push_str(&digits[1..]);
        }
        let esign = if exp < 0 { '-' } else { '+' };
        return format!("{sign}{m}e{esign}{:02}", exp.abs());
    }
    let point = exp + 1;
    let s = if point <= 0 {
        format!("0.{}{}", "0".repeat((-point) as usize), digits)
    } else if point as usize >= digits.len() {
        format!("{}{}.0", digits, "0".repeat(point as usize - digits.len()))
    } else {
        format!(
            "{}.{}",
            &digits[..point as usize],
            &digits[point as usize..]
        )
    };
    format!("{sign}{s}")
}

/// `repr(str)`: single quotes unless the text has `'` and no `"`.
pub fn str_repr(s: &str) -> String {
    let quote = if s.contains('\'') && !s.contains('"') {
        '"'
    } else {
        '\''
    };
    let mut out = String::with_capacity(s.len() + 2);
    out.push(quote);
    for c in s.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if c == quote => {
                out.push('\\');
                out.push(c);
            }
            c if (c as u32) < 0x20 || c as u32 == 0x7f => {
                out.push_str(&format!("\\x{:02x}", c as u32));
            }
            c => out.push(c),
        }
    }
    out.push(quote);
    out
}

/// `repr(list_of_str)`.
pub fn list_repr(items: &[String]) -> String {
    let inner: Vec<String> = items.iter().map(|s| str_repr(s)).collect();
    format!("[{}]", inner.join(", "))
}

/// `repr` of a JSON-decoded value.
pub fn value_repr(v: &Value) -> String {
    match v {
        Value::String(s) => str_repr(s),
        Value::Array(a) => {
            let inner: Vec<String> = a.iter().map(value_repr).collect();
            format!("[{}]", inner.join(", "))
        }
        Value::Object(o) => {
            let inner: Vec<String> = o
                .iter()
                .map(|(k, v)| format!("{}: {}", str_repr(k), value_repr(v)))
                .collect();
            format!("{{{}}}", inner.join(", "))
        }
        other => value_str(other),
    }
}

/// `str(value)` of a JSON-decoded value.
pub fn value_str(v: &Value) -> String {
    match v {
        Value::Null => "None".into(),
        Value::Bool(true) => "True".into(),
        Value::Bool(false) => "False".into(),
        Value::Number(n) => {
            if n.is_f64() {
                float_repr(n.as_f64().unwrap_or(0.0))
            } else {
                n.to_string()
            }
        }
        Value::String(s) => s.clone(),
        other => value_repr(other),
    }
}

/// `isinstance(value, numbers.Number)` (bools count, as in Python).
pub fn is_number(v: &Value) -> bool {
    matches!(v, Value::Number(_) | Value::Bool(_))
}

/// Python truthiness of a JSON value.
pub fn truthy(v: &Value) -> bool {
    lp_core::extract::py_truthy(v)
}

/// `int(value)` of a number (truncating floats), for Django IntegerFields.
pub fn as_int(v: &Value) -> Option<i64> {
    match v {
        Value::Number(n) => n.as_i64().or_else(|| n.as_f64().map(|f| f.trunc() as i64)),
        Value::Bool(b) => Some(*b as i64),
        _ => None,
    }
}

pub fn as_float(v: &Value) -> Option<f64> {
    match v {
        Value::Number(n) => n.as_f64(),
        Value::Bool(b) => Some(*b as i64 as f64),
        _ => None,
    }
}

/// `str(Fraction(x).limit_denominator(1000))` for a positive number.
pub fn fraction_limited(v: &Value, max_den: u128) -> Option<String> {
    let (num, den): (i128, u128) = match v {
        Value::Number(n) if n.is_i64() => (n.as_i64()? as i128, 1),
        Value::Number(n) if n.is_u64() => (n.as_u64()? as i128, 1),
        Value::Number(n) => float_ratio(n.as_f64()?)?,
        Value::Bool(b) => (*b as i128, 1),
        _ => return None,
    };
    let (p, q) = limit_denominator(num, den, max_den);
    Some(if q == 1 {
        p.to_string()
    } else {
        format!("{p}/{q}")
    })
}

/// `float.as_integer_ratio()`, when it fits.
fn float_ratio(x: f64) -> Option<(i128, u128)> {
    if !x.is_finite() {
        return None;
    }
    if x == 0.0 {
        return Some((0, 1));
    }
    let bits = x.to_bits();
    let neg = bits >> 63 == 1;
    let exp = ((bits >> 52) & 0x7ff) as i32;
    let frac = bits & ((1u64 << 52) - 1);
    let (mut m, mut e) = if exp == 0 {
        (frac as u128, -1074)
    } else {
        ((frac | (1u64 << 52)) as u128, exp - 1075)
    };
    while m & 1 == 0 && e < 0 {
        m >>= 1;
        e += 1;
    }
    let (n, d) = if e >= 0 {
        if e > 70 {
            return None;
        }
        (m << e, 1u128)
    } else {
        if -e > 120 {
            return None;
        }
        (m, 1u128 << (-e))
    };
    let n = n as i128;
    Some((if neg { -n } else { n }, d))
}

/// `Fraction.limit_denominator` (CPython 3.11), for a reduced n/d with d > 0.
fn limit_denominator(n0: i128, d0: u128, max_den: u128) -> (i128, u128) {
    if d0 <= max_den {
        return (n0, d0);
    }
    let d0i = d0 as i128;
    let max = max_den as i128;
    let (mut p0, mut q0, mut p1, mut q1) = (0i128, 1i128, 1i128, 0i128);
    let (mut n, mut d) = (n0, d0i);
    loop {
        let a = n.div_euclid(d);
        let q2 = q0 + a * q1;
        if q2 > max {
            break;
        }
        let (np0, nq0, np1, nq1) = (p1, q1, p0 + a * p1, q2);
        p0 = np0;
        q0 = nq0;
        p1 = np1;
        q1 = nq1;
        let r = n - a * d;
        n = d;
        d = r;
    }
    let k = (max - q0).div_euclid(q1);
    if 2 * d * (q0 + k * q1) <= d0i {
        (p1, q1 as u128)
    } else {
        (p0 + k * p1, (q0 + k * q1) as u128)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn floats_like_python() {
        assert_eq!(float_repr(1.0), "1.0");
        assert_eq!(float_repr(2.5), "2.5");
        assert_eq!(float_repr(0.0001), "0.0001");
        assert_eq!(float_repr(0.00001), "1e-05");
        assert_eq!(float_repr(1e16), "1e+16");
        assert_eq!(float_repr(123456789012345.6), "123456789012345.6");
        assert_eq!(float_repr(1.5e-7), "1.5e-07");
        assert_eq!(float_repr(-3.25), "-3.25");
        assert_eq!(float_repr(0.1), "0.1");
    }

    #[test]
    fn values_like_python_str() {
        assert_eq!(value_str(&json!(2)), "2");
        assert_eq!(value_str(&json!(2.0)), "2.0");
        assert_eq!(value_str(&json!("045")), "045");
    }

    #[test]
    fn reprs() {
        assert_eq!(str_repr(r"C:\a b.jpg"), r"'C:\\a b.jpg'");
        assert_eq!(str_repr("it's"), "\"it's\"");
        assert_eq!(
            list_repr(&["a".into(), "b".into()]),
            "['a', 'b']".to_string()
        );
    }

    #[test]
    fn fractions_like_python() {
        // str(Fraction(x).limit_denominator(1000)) in CPython 3.11
        assert_eq!(fraction_limited(&json!(0.004), 1000).unwrap(), "1/250");
        assert_eq!(
            fraction_limited(&json!(0.0166666666), 1000).unwrap(),
            "1/60"
        );
        assert_eq!(fraction_limited(&json!(2), 1000).unwrap(), "2");
        assert_eq!(fraction_limited(&json!(0.5), 1000).unwrap(), "1/2");
        assert_eq!(fraction_limited(&json!(1.3), 1000).unwrap(), "13/10");
        assert_eq!(fraction_limited(&json!(0.000125), 1000).unwrap(), "0");
        assert_eq!(fraction_limited(&json!(0.0008), 1000).unwrap(), "1/1000");
    }
}
