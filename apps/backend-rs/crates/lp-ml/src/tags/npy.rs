//! `np.load` / `np.save` for the little-endian float arrays of the tag
//! embedding cache (`tag_embeddings.npy`, written by the Python taggers or
//! by [`super::tagger`]).

use std::io::Write;
use std::path::Path;

use anyhow::{Context, bail};

const MAGIC: &[u8] = b"\x93NUMPY";

/// A C-order float array as f32 (`<f4`, or `<f8` narrowed).
pub fn read_f32(path: &Path) -> anyhow::Result<(Vec<usize>, Vec<f32>)> {
    let bytes = std::fs::read(path).with_context(|| format!("reading {}", path.display()))?;
    parse_f32(&bytes).with_context(|| format!("parsing {}", path.display()))
}

pub fn parse_f32(bytes: &[u8]) -> anyhow::Result<(Vec<usize>, Vec<f32>)> {
    if bytes.len() < 10 || &bytes[..6] != MAGIC {
        bail!("not an .npy file");
    }
    let (len, start) = match bytes[6] {
        1 => (u16::from_le_bytes([bytes[8], bytes[9]]) as usize, 10),
        2 | 3 if bytes.len() >= 12 => (
            u32::from_le_bytes([bytes[8], bytes[9], bytes[10], bytes[11]]) as usize,
            12,
        ),
        v => bail!("unsupported .npy version {v}"),
    };
    let header = bytes
        .get(start..start + len)
        .context("truncated .npy header")?;
    let header = std::str::from_utf8(header).context(".npy header is not text")?;
    let descr = dict_value(header, "descr").context(".npy header has no descr")?;
    let descr = descr.trim_matches(|c| c == '\'' || c == '"');
    if dict_value(header, "fortran_order").is_some_and(|v| v.trim() == "True") {
        bail!("Fortran-order arrays are not supported");
    }
    let shape = dict_value(header, "shape").context(".npy header has no shape")?;
    let shape: Vec<usize> = shape
        .trim()
        .trim_start_matches('(')
        .trim_end_matches(')')
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.parse::<usize>().context("bad .npy shape"))
        .collect::<anyhow::Result<_>>()?;
    let count: usize = shape.iter().product();
    let body = &bytes[start + len..];
    let data = match descr {
        "<f4" | "=f4" | "|f4" => {
            if body.len() < count * 4 {
                bail!("truncated .npy data");
            }
            body[..count * 4]
                .chunks_exact(4)
                .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
                .collect()
        }
        "<f8" | "=f8" => {
            if body.len() < count * 8 {
                bail!("truncated .npy data");
            }
            body[..count * 8]
                .chunks_exact(8)
                .map(|c| f64::from_le_bytes(c.try_into().expect("8 bytes")) as f32)
                .collect()
        }
        other => bail!("unsupported .npy dtype {other}"),
    };
    Ok((shape, data))
}

/// The value text of `'key': value` in the header dict (a tuple for shape).
fn dict_value<'a>(header: &'a str, key: &str) -> Option<&'a str> {
    let at = header
        .find(&format!("'{key}'"))
        .or_else(|| header.find(&format!("\"{key}\"")))?;
    let rest = &header[at + key.len() + 2..];
    let rest = rest.trim_start().strip_prefix(':')?.trim_start();
    let end = if rest.starts_with('(') {
        rest.find(')')? + 1
    } else {
        rest.find([',', '}']).unwrap_or(rest.len())
    };
    Some(&rest[..end])
}

/// `np.save(path, array)` of a C-order f32 array (format 1.0), written to a
/// temporary file and renamed so a concurrent reader never sees half of it.
pub fn write_f32(path: &Path, shape: &[usize], data: &[f32]) -> anyhow::Result<()> {
    assert_eq!(shape.iter().product::<usize>(), data.len(), "npy shape");
    let dims = match shape {
        [d] => format!("({d},)"),
        _ => format!(
            "({})",
            shape
                .iter()
                .map(usize::to_string)
                .collect::<Vec<_>>()
                .join(", ")
        ),
    };
    let mut header = format!("{{'descr': '<f4', 'fortran_order': False, 'shape': {dims}, }}");
    // Magic (6) + version (2) + length (2) + header + '\n', padded to 64.
    let unpadded = 10 + header.len() + 1;
    header.push_str(&" ".repeat(unpadded.next_multiple_of(64) - unpadded));
    header.push('\n');

    let mut out = Vec::with_capacity(10 + header.len() + data.len() * 4);
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(&[1, 0]);
    out.extend_from_slice(&(header.len() as u16).to_le_bytes());
    out.extend_from_slice(header.as_bytes());
    for v in data {
        out.extend_from_slice(&v.to_le_bytes());
    }

    let dir = path.parent().context("npy path has no parent")?;
    std::fs::create_dir_all(dir).with_context(|| format!("creating {}", dir.display()))?;
    let mut tmp = tempfile::NamedTempFile::new_in(dir)
        .with_context(|| format!("creating a temporary file in {}", dir.display()))?;
    tmp.write_all(&out)?;
    tmp.persist(path)
        .with_context(|| format!("writing {}", path.display()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("a.npy");
        let data: Vec<f32> = (0..6).map(|i| i as f32 * 0.5 - 1.0).collect();
        write_f32(&p, &[2, 3], &data).unwrap();
        let bytes = std::fs::read(&p).unwrap();
        assert_eq!((bytes.len() - data.len() * 4) % 64, 0, "header alignment");
        assert_eq!(read_f32(&p).unwrap(), (vec![2, 3], data));
    }

    #[test]
    fn reads_numpy_headers() {
        let mut b = MAGIC.to_vec();
        let h = "{'descr': '<f8', 'fortran_order': False, 'shape': (2,), }         \n";
        b.extend_from_slice(&[1, 0]);
        b.extend_from_slice(&(h.len() as u16).to_le_bytes());
        b.extend_from_slice(h.as_bytes());
        b.extend_from_slice(&1.5f64.to_le_bytes());
        b.extend_from_slice(&(-2.0f64).to_le_bytes());
        assert_eq!(parse_f32(&b).unwrap(), (vec![2], vec![1.5, -2.0]));
        assert!(parse_f32(b"nope").is_err());
    }
}
