//! Just enough of an ONNX file's protobuf to route it like insightface's
//! `ModelRouter` (input shape, output count) and `ArcFaceONNX` (the names of
//! the first graph nodes) without creating a session. The initializers are
//! skipped with seeks, so a 250 MB model costs a few reads.

use std::fs::File;
use std::io::{BufReader, Read};
use std::path::Path;

use anyhow::{Context, bail};

/// One input dimension: a fixed size, or symbolic / unknown.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Dim {
    Fixed(i64),
    Symbolic,
}

#[derive(Debug, Clone, Default)]
pub struct ModelInfo {
    /// Graph inputs that are not initializers: (name, dims).
    pub inputs: Vec<(String, Vec<Dim>)>,
    pub outputs: usize,
    /// Names of the first 8 nodes (what `ArcFaceONNX` inspects).
    pub first_nodes: Vec<String>,
}

impl ModelInfo {
    pub fn input_dims(&self) -> &[Dim] {
        self.inputs
            .first()
            .map(|(_, d)| d.as_slice())
            .unwrap_or(&[])
    }

    /// `input_shape[i]` as a number, `None` when symbolic or missing.
    pub fn input_dim(&self, i: usize) -> Option<i64> {
        match self.input_dims().get(i) {
            Some(Dim::Fixed(n)) => Some(*n),
            _ => None,
        }
    }
}

const NODES_KEPT: usize = 8;

pub fn read(path: &Path) -> anyhow::Result<ModelInfo> {
    let f = File::open(path).with_context(|| format!("opening {}", path.display()))?;
    let len = f.metadata()?.len();
    let mut r = Reader {
        inner: BufReader::with_capacity(1 << 16, f),
        pos: 0,
    };
    let mut info = ModelInfo::default();
    let mut raw_inputs = Vec::new();
    let mut initializers = std::collections::HashSet::new();
    while r.pos < len {
        let (field, wire) = r.key()?;
        if field == 7 && wire == 2 {
            let end = r.len_end()?;
            parse_graph(&mut r, end, &mut info, &mut raw_inputs, &mut initializers)?;
        } else {
            r.skip(wire)?;
        }
    }
    info.inputs = raw_inputs
        .into_iter()
        .filter(|(n, _)| !initializers.contains(n))
        .collect();
    Ok(info)
}

fn parse_graph(
    r: &mut Reader,
    end: u64,
    info: &mut ModelInfo,
    inputs: &mut Vec<(String, Vec<Dim>)>,
    initializers: &mut std::collections::HashSet<String>,
) -> anyhow::Result<()> {
    let mut nodes = 0usize;
    while r.pos < end {
        let (field, wire) = r.key()?;
        match (field, wire) {
            (1, 2) => {
                let e = r.len_end()?;
                if nodes < NODES_KEPT {
                    let mut name = String::new();
                    while r.pos < e {
                        let (f, w) = r.key()?;
                        if f == 3 && w == 2 {
                            name = r.string()?;
                        } else {
                            r.skip(w)?;
                        }
                    }
                    info.first_nodes.push(name);
                } else {
                    r.seek_to(e)?;
                }
                nodes += 1;
            }
            (5, 2) => {
                let e = r.len_end()?;
                while r.pos < e {
                    let (f, w) = r.key()?;
                    if f == 8 && w == 2 {
                        initializers.insert(r.string()?);
                    } else {
                        r.skip(w)?;
                    }
                }
            }
            (11, 2) => {
                let e = r.len_end()?;
                inputs.push(parse_value_info(r, e)?);
            }
            (12, 2) => {
                let e = r.len_end()?;
                r.seek_to(e)?;
                info.outputs += 1;
            }
            _ => r.skip(wire)?,
        }
    }
    Ok(())
}

/// ValueInfoProto: name = 1, type = 2 (TypeProto.tensor_type = 1 ->
/// shape = 2 -> dim = 1 -> dim_value = 1 | dim_param = 2).
fn parse_value_info(r: &mut Reader, end: u64) -> anyhow::Result<(String, Vec<Dim>)> {
    let mut name = String::new();
    let mut dims = Vec::new();
    while r.pos < end {
        let (f, w) = r.key()?;
        match (f, w) {
            (1, 2) => name = r.string()?,
            (2, 2) => {
                let type_end = r.len_end()?;
                while r.pos < type_end {
                    let (f, w) = r.key()?;
                    if f == 1 && w == 2 {
                        let tensor_end = r.len_end()?;
                        while r.pos < tensor_end {
                            let (f, w) = r.key()?;
                            if f == 2 && w == 2 {
                                let shape_end = r.len_end()?;
                                while r.pos < shape_end {
                                    let (f, w) = r.key()?;
                                    if f == 1 && w == 2 {
                                        let dim_end = r.len_end()?;
                                        let mut dim = Dim::Symbolic;
                                        while r.pos < dim_end {
                                            let (f, w) = r.key()?;
                                            if f == 1 && w == 0 {
                                                dim = Dim::Fixed(r.varint()? as i64);
                                            } else {
                                                r.skip(w)?;
                                            }
                                        }
                                        dims.push(dim);
                                    } else {
                                        r.skip(w)?;
                                    }
                                }
                            } else {
                                r.skip(w)?;
                            }
                        }
                    } else {
                        r.skip(w)?;
                    }
                }
            }
            _ => r.skip(w)?,
        }
    }
    Ok((name, dims))
}

struct Reader {
    inner: BufReader<File>,
    pos: u64,
}

impl Reader {
    fn byte(&mut self) -> anyhow::Result<u8> {
        let mut b = [0u8; 1];
        self.inner
            .read_exact(&mut b)
            .context("truncated ONNX file")?;
        self.pos += 1;
        Ok(b[0])
    }

    fn varint(&mut self) -> anyhow::Result<u64> {
        let mut v = 0u64;
        for shift in (0..70).step_by(7) {
            let b = self.byte()?;
            v |= u64::from(b & 0x7f) << shift;
            if b & 0x80 == 0 {
                return Ok(v);
            }
        }
        bail!("bad varint in ONNX file")
    }

    fn key(&mut self) -> anyhow::Result<(u64, u8)> {
        let k = self.varint()?;
        Ok((k >> 3, (k & 7) as u8))
    }

    /// Reads a length prefix; returns the absolute end of the field.
    fn len_end(&mut self) -> anyhow::Result<u64> {
        let n = self.varint()?;
        Ok(self.pos + n)
    }

    fn string(&mut self) -> anyhow::Result<String> {
        let n = self.varint()? as usize;
        if n > 1 << 20 {
            bail!("implausible string length in ONNX file");
        }
        let mut buf = vec![0u8; n];
        self.inner
            .read_exact(&mut buf)
            .context("truncated ONNX file")?;
        self.pos += n as u64;
        Ok(String::from_utf8_lossy(&buf).into_owned())
    }

    fn seek_to(&mut self, end: u64) -> anyhow::Result<()> {
        let delta = end as i64 - self.pos as i64;
        self.inner.seek_relative(delta)?;
        self.pos = end;
        Ok(())
    }

    fn skip(&mut self, wire: u8) -> anyhow::Result<()> {
        match wire {
            0 => {
                self.varint()?;
            }
            1 => self.seek_to(self.pos + 8)?,
            2 => {
                let e = self.len_end()?;
                self.seek_to(e)?;
            }
            5 => self.seek_to(self.pos + 4)?,
            w => bail!("unsupported protobuf wire type {w} in ONNX file"),
        }
        Ok(())
    }
}
