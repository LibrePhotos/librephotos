use std::ops::Range;

struct BoxRef {
    typ: [u8; 4],
    body: Range<usize>,
}

fn boxes(d: &[u8], range: Range<usize>) -> Vec<BoxRef> {
    let mut out = Vec::new();
    let mut o = range.start;
    while o + 8 <= range.end {
        let size = u32::from_be_bytes(d[o..o + 4].try_into().unwrap()) as usize;
        let typ: [u8; 4] = d[o + 4..o + 8].try_into().unwrap();
        let (hdr, size) = match size {
            0 => (8, range.end - o),
            1 => {
                if o + 16 > range.end {
                    break;
                }
                (
                    16,
                    u64::from_be_bytes(d[o + 8..o + 16].try_into().unwrap()) as usize,
                )
            }
            s => (8, s),
        };
        if size < hdr || o + size > range.end {
            break;
        }
        out.push(BoxRef {
            typ,
            body: o + hdr..o + size,
        });
        o += size;
    }
    out
}

fn find<'a>(bs: &'a [BoxRef], typ: &[u8; 4]) -> Option<&'a BoxRef> {
    bs.iter().find(|b| &b.typ == typ)
}

struct Reader<'a> {
    d: &'a [u8],
    p: usize,
    end: usize,
}

impl Reader<'_> {
    fn take(&mut self, n: usize) -> Option<u64> {
        if self.p + n > self.end {
            return None;
        }
        let mut v = 0u64;
        for &b in &self.d[self.p..self.p + n] {
            v = (v << 8) | b as u64;
        }
        self.p += n;
        Some(v)
    }
    fn u8(&mut self) -> Option<u8> {
        self.take(1).map(|v| v as u8)
    }
    fn u16(&mut self) -> Option<u16> {
        self.take(2).map(|v| v as u16)
    }
    fn u32(&mut self) -> Option<u32> {
        self.take(4).map(|v| v as u32)
    }
}

fn reader<'a>(d: &'a [u8], r: &Range<usize>) -> Reader<'a> {
    Reader {
        d,
        p: r.start,
        end: r.end,
    }
}

fn thumbnail_item(d: &[u8], meta: &[BoxRef]) -> Option<u32> {
    let pitm = find(meta, b"pitm")?;
    let mut r = reader(d, &pitm.body);
    let v = r.u8()?;
    r.take(3)?;
    let primary = if v == 0 { r.u16()? as u32 } else { r.u32()? };
    let iref = find(meta, b"iref")?;
    let mut r = reader(d, &iref.body);
    let v = r.u8()?;
    let refs = boxes(d, iref.body.start + 4..iref.body.end);
    let id = |r: &mut Reader| {
        if v == 0 {
            r.u16().map(u32::from)
        } else {
            r.u32()
        }
    };
    let _ = r.take(3);
    for b in refs.iter().filter(|b| &b.typ == b"thmb") {
        let mut r = reader(d, &b.body);
        let from = id(&mut r)?;
        let n = r.u16()?;
        for _ in 0..n {
            if id(&mut r)? == primary {
                return Some(from);
            }
        }
    }
    None
}

fn item_type(d: &[u8], meta: &[BoxRef], item: u32) -> Option<[u8; 4]> {
    let iinf = find(meta, b"iinf")?;
    let v = d[iinf.body.start];
    let start = iinf.body.start + 4 + if v == 0 { 2 } else { 4 };
    for infe in boxes(d, start..iinf.body.end)
        .iter()
        .filter(|b| &b.typ == b"infe")
    {
        let mut r = reader(d, &infe.body);
        let ver = r.u8()?;
        r.take(3)?;
        if ver < 2 {
            continue;
        }
        let id = if ver == 2 { r.u16()? as u32 } else { r.u32()? };
        r.u16()?;
        if id == item {
            return r.take(4)?.to_be_bytes()[4..].try_into().ok();
        }
    }
    None
}

fn item_properties(d: &[u8], meta: &[BoxRef], item: u32) -> Option<Vec<Vec<u8>>> {
    let iprp = find(meta, b"iprp")?;
    let kids = boxes(d, iprp.body.clone());
    let ipco = find(&kids, b"ipco")?;
    let props = boxes(d, ipco.body.clone());
    let ipma = find(&kids, b"ipma")?;
    let mut r = reader(d, &ipma.body);
    let v = r.u8()?;
    let flags = r.take(3)?;
    let n = r.u32()?;
    for _ in 0..n {
        let id = if v < 1 { r.u16()? as u32 } else { r.u32()? };
        let count = r.u8()?;
        let mut idx = Vec::new();
        for _ in 0..count {
            idx.push(if flags & 1 == 1 {
                (r.u16()? & 0x7fff) as usize
            } else {
                (r.u8()? & 0x7f) as usize
            });
        }
        if id == item {
            let mut out: Vec<Vec<u8>> = idx
                .into_iter()
                .filter(|&i| i >= 1 && i <= props.len())
                .map(|i| {
                    let b = &props[i - 1];
                    d[b.body.start - 8..b.body.end].to_vec()
                })
                .collect();
            out.sort_by_key(|b| &b[4..8] != b"hvcC");
            return out
                .first()
                .is_some_and(|b| &b[4..8] == b"hvcC")
                .then_some(out);
        }
    }
    None
}

fn item_data(d: &[u8], meta: &[BoxRef], item: u32) -> Option<Vec<u8>> {
    let iloc = find(meta, b"iloc")?;
    let mut r = reader(d, &iloc.body);
    let v = r.u8()?;
    r.take(3)?;
    let a = r.u8()?;
    let b = r.u8()?;
    let (off_sz, len_sz, base_sz) = ((a >> 4) as usize, (a & 15) as usize, (b >> 4) as usize);
    let idx_sz = if v == 1 || v == 2 {
        (b & 15) as usize
    } else {
        0
    };
    let count = if v < 2 { r.u16()? as u32 } else { r.u32()? };
    for _ in 0..count {
        let id = if v < 2 { r.u16()? as u32 } else { r.u32()? };
        let method = if v == 1 || v == 2 { r.u16()? & 15 } else { 0 };
        r.u16()?;
        let base = r.take(base_sz)? as usize;
        let extents = r.u16()?;
        let mut data = Vec::new();
        for _ in 0..extents {
            r.take(idx_sz)?;
            let off = r.take(off_sz)? as usize;
            let len = r.take(len_sz)? as usize;
            if id != item {
                continue;
            }
            let src = match method {
                0 => d.get(base + off..base + off + len)?,
                1 => {
                    let idat = find(meta, b"idat")?;
                    d.get(idat.body.start + base + off..idat.body.start + base + off + len)?
                }
                _ => return None,
            };
            data.extend_from_slice(src);
        }
        if id == item {
            return (!data.is_empty()).then_some(data);
        }
    }
    None
}

fn bx(typ: &[u8; 4], body: &[u8]) -> Vec<u8> {
    let mut v = ((body.len() + 8) as u32).to_be_bytes().to_vec();
    v.extend_from_slice(typ);
    v.extend_from_slice(body);
    v
}

fn full_box(typ: &[u8; 4], version: u8, body: &[u8]) -> Vec<u8> {
    let mut b = vec![version, 0, 0, 0];
    b.extend_from_slice(body);
    bx(typ, &b)
}

pub fn thumbnail_file(d: &[u8]) -> Option<Vec<u8>> {
    let top = boxes(d, 0..d.len());
    let meta_box = find(&top, b"meta")?;
    let meta = boxes(d, meta_box.body.start + 4..meta_box.body.end);
    let item = thumbnail_item(d, &meta)?;
    if &item_type(d, &meta, item)? != b"hvc1" {
        return None;
    }
    let props = item_properties(d, &meta, item)?;
    let data = item_data(d, &meta, item)?;

    let ftyp = bx(b"ftyp", b"heic\0\0\0\0mif1heic");
    let mut hdlr = vec![0u8; 4];
    hdlr.extend_from_slice(b"pict");
    hdlr.extend_from_slice(&[0u8; 13]);
    let hdlr = full_box(b"hdlr", 0, &hdlr);
    let pitm = full_box(b"pitm", 0, &1u16.to_be_bytes());
    let mut infe = 1u16.to_be_bytes().to_vec();
    infe.extend_from_slice(&0u16.to_be_bytes());
    infe.extend_from_slice(b"hvc1\0");
    let mut iinf = 1u16.to_be_bytes().to_vec();
    iinf.extend_from_slice(&full_box(b"infe", 2, &infe));
    let iinf = full_box(b"iinf", 0, &iinf);
    let ipco = bx(b"ipco", &props.concat());
    let mut ipma = 1u32.to_be_bytes().to_vec();
    ipma.extend_from_slice(&1u16.to_be_bytes());
    ipma.push(props.len().min(127) as u8);
    for i in 0..props.len().min(127) {
        let essential = if i == 0 { 0x80 } else { 0 };
        ipma.push(essential | (i as u8 + 1));
    }
    let iprp = bx(b"iprp", &[ipco, full_box(b"ipma", 0, &ipma)].concat());
    let mut iloc = vec![0x44, 0x00];
    iloc.extend_from_slice(&1u16.to_be_bytes());
    iloc.extend_from_slice(&1u16.to_be_bytes());
    iloc.extend_from_slice(&0u16.to_be_bytes());
    iloc.extend_from_slice(&1u16.to_be_bytes());
    let off_at = iloc.len();
    iloc.extend_from_slice(&0u32.to_be_bytes());
    iloc.extend_from_slice(&(data.len() as u32).to_be_bytes());
    let mut iloc = full_box(b"iloc", 0, &iloc);
    let meta_len = 12 + hdlr.len() + pitm.len() + iinf.len() + iprp.len() + iloc.len();
    let data_at = (ftyp.len() + meta_len + 8) as u32;
    let p = 12 + off_at;
    iloc[p..p + 4].copy_from_slice(&data_at.to_be_bytes());
    let meta = full_box(b"meta", 0, &[hdlr, pitm, iinf, iprp, iloc].concat());
    debug_assert_eq!(meta.len(), meta_len);
    Some([ftyp, meta, bx(b"mdat", &data)].concat())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_non_heif_and_files_without_thumbnail() {
        assert!(thumbnail_file(b"").is_none());
        assert!(thumbnail_file(b"\0\0\0\x10ftypheic\0\0\0\0").is_none());
        let meta = full_box(b"meta", 0, &full_box(b"pitm", 0, &1u16.to_be_bytes()));
        assert!(thumbnail_file(&[bx(b"ftyp", b"heic\0\0\0\0"), meta].concat()).is_none());
    }

    #[test]
    fn extracts_thumbnail_item() {
        let hvcc = bx(b"hvcC", &[1, 2, 3]);
        let ispe = full_box(b"ispe", 0, &[0, 0, 1, 64, 0, 0, 0, 240]);
        let mut infe1 = 1u16.to_be_bytes().to_vec();
        infe1.extend_from_slice(&[0, 0]);
        infe1.extend_from_slice(b"hvc1\0");
        let mut infe2 = 2u16.to_be_bytes().to_vec();
        infe2.extend_from_slice(&[0, 0]);
        infe2.extend_from_slice(b"grid\0");
        let iinf = full_box(
            b"iinf",
            0,
            &[
                2u16.to_be_bytes().to_vec(),
                full_box(b"infe", 2, &infe1),
                full_box(b"infe", 2, &infe2),
            ]
            .concat(),
        );
        let thmb = bx(b"thmb", &[0, 1, 0, 1, 0, 2]);
        let iref = full_box(b"iref", 0, &thmb);
        let ipma = full_box(b"ipma", 0, &[0, 0, 0, 1, 0, 1, 2, 0x81, 2]);
        let iprp = bx(
            b"iprp",
            &[bx(b"ipco", &[hvcc.clone(), ispe.clone()].concat()), ipma].concat(),
        );
        let payload = b"HEVCDATA";
        let iloc_body = |off: u32| {
            let mut v = vec![0x44, 0, 0, 1, 0, 1, 0, 0, 0, 1];
            v.extend_from_slice(&off.to_be_bytes());
            v.extend_from_slice(&(payload.len() as u32).to_be_bytes());
            full_box(b"iloc", 0, &v)
        };
        let pitm = full_box(b"pitm", 0, &2u16.to_be_bytes());
        let ftyp = bx(b"ftyp", b"heic\0\0\0\0mif1");
        let build = |off| {
            let meta = full_box(
                b"meta",
                0,
                &[
                    pitm.clone(),
                    iinf.clone(),
                    iref.clone(),
                    iprp.clone(),
                    iloc_body(off),
                ]
                .concat(),
            );
            [ftyp.clone(), meta, bx(b"mdat", payload)].concat()
        };
        let probe = build(0);
        let off = (probe.len() - payload.len()) as u32;
        let file = build(off);
        let out = thumbnail_file(&file).expect("thumbnail");
        assert!(out.ends_with(payload));
        let top = boxes(&out, 0..out.len());
        let meta = find(&top, b"meta").unwrap();
        let kids = boxes(&out, meta.body.start + 4..meta.body.end);
        assert_eq!(item_data(&out, &kids, 1).unwrap(), payload);
        let props = item_properties(&out, &kids, 1).unwrap();
        assert_eq!(props, vec![hvcc, ispe]);
    }
}
