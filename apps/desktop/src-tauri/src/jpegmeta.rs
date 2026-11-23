use std::io::{Read, Seek, SeekFrom, Write};
use std::ops::Range;
use std::path::Path;

pub const TAG_ORIENTATION: u16 = 0x0112;
const TAG_THUMB_OFFSET: u16 = 0x0201;
const TAG_THUMB_LENGTH: u16 = 0x0202;

#[derive(Debug, Clone)]
pub struct Segment {
    pub marker: u8,
    pub start: usize,
    pub payload: Range<usize>,
}

impl Segment {
    pub fn end(&self) -> usize {
        self.payload.end
    }
}

pub fn segments(buf: &[u8]) -> Option<Vec<Segment>> {
    if buf.len() < 4 || buf[0] != 0xFF || buf[1] != 0xD8 {
        return None;
    }
    let mut out = Vec::new();
    let mut i = 2;
    while i + 1 < buf.len() {
        if buf[i] != 0xFF {
            break;
        }
        let mut j = i + 1;
        while j < buf.len() && buf[j] == 0xFF {
            j += 1;
        }
        if j >= buf.len() {
            break;
        }
        let marker = buf[j];
        if (0xD0..=0xD7).contains(&marker) || marker == 0x01 {
            i = j + 1;
            continue;
        }
        if marker == 0xD9 || j + 2 >= buf.len() {
            break;
        }
        let len = u16::from_be_bytes([buf[j + 1], buf[j + 2]]) as usize;
        if len < 2 {
            break;
        }
        let payload = j + 3..j + 1 + len;
        let truncated = payload.end > buf.len();
        out.push(Segment {
            marker,
            start: i,
            payload: payload.start..payload.end.min(buf.len()),
        });
        if marker == 0xDA || truncated {
            break;
        }
        i = payload.end;
    }
    Some(out)
}

const EXIF_ID: &[u8] = b"Exif\0\0";

fn exif_segment(buf: &[u8], segs: &[Segment]) -> Option<Segment> {
    segs.iter()
        .find(|s| s.marker == 0xE1 && buf[s.payload.clone()].starts_with(EXIF_ID))
        .cloned()
}

pub fn sof_dims(buf: &[u8], segs: &[Segment]) -> Option<(u32, u32)> {
    let s = segs
        .iter()
        .find(|s| matches!(s.marker, 0xC0..=0xC3 | 0xC5..=0xC7 | 0xC9..=0xCB | 0xCD..=0xCF))?;
    let p = &buf[s.payload.clone()];
    if p.len() < 5 {
        return None;
    }
    let h = u16::from_be_bytes([p[1], p[2]]) as u32;
    let w = u16::from_be_bytes([p[3], p[4]]) as u32;
    (w > 0 && h > 0).then_some((w, h))
}

pub struct Tiff<'a> {
    pub d: &'a [u8],
    pub le: bool,
}

pub struct Entry {
    pub at: usize,
    pub typ: u16,
    pub count: u32,
}

impl<'a> Tiff<'a> {
    pub fn new(d: &'a [u8]) -> Option<Tiff<'a>> {
        let le = match d.get(..4)? {
            [b'I', b'I', 42, 0] => true,
            [b'M', b'M', 0, 42] => false,
            _ => return None,
        };
        Some(Tiff { d, le })
    }

    pub fn u16(&self, at: usize) -> Option<u16> {
        let b: [u8; 2] = self.d.get(at..at + 2)?.try_into().ok()?;
        Some(if self.le {
            u16::from_le_bytes(b)
        } else {
            u16::from_be_bytes(b)
        })
    }

    pub fn u32(&self, at: usize) -> Option<u32> {
        let b: [u8; 4] = self.d.get(at..at + 4)?.try_into().ok()?;
        Some(if self.le {
            u32::from_le_bytes(b)
        } else {
            u32::from_be_bytes(b)
        })
    }

    pub fn ifd0(&self) -> Option<usize> {
        Some(self.u32(4)? as usize)
    }

    pub fn entries(&self, ifd: usize) -> Option<Vec<Entry>> {
        let n = self.u16(ifd)? as usize;
        if n > 1000 || ifd + 2 + n * 12 + 4 > self.d.len() {
            return None;
        }
        Some(
            (0..n)
                .map(|i| {
                    let at = ifd + 2 + i * 12;
                    Entry {
                        at,
                        typ: self.u16(at + 2).unwrap_or(0),
                        count: self.u32(at + 4).unwrap_or(0),
                    }
                })
                .collect(),
        )
    }

    pub fn tag(&self, at: usize) -> u16 {
        self.u16(at).unwrap_or(0)
    }

    pub fn find(&self, ifd: usize, tag: u16) -> Option<Entry> {
        self.entries(ifd)?
            .into_iter()
            .find(|e| self.tag(e.at) == tag)
    }

    pub fn next_ifd(&self, ifd: usize) -> Option<usize> {
        let n = self.u16(ifd)? as usize;
        let next = self.u32(ifd + 2 + n * 12)? as usize;
        (next != 0).then_some(next)
    }

    pub fn scalar(&self, e: &Entry) -> Option<u32> {
        match e.typ {
            3 => self.u16(e.at + 8).map(u32::from),
            4 => self.u32(e.at + 8),
            _ => None,
        }
    }

    pub fn orientation(&self) -> Option<(u16, usize)> {
        let e = self.find(self.ifd0()?, TAG_ORIENTATION)?;
        if e.typ != 3 {
            return None;
        }
        let v = self.u16(e.at + 8)?;
        Some((v, e.at + 8))
    }

    pub fn thumbnail(&self) -> Option<Range<usize>> {
        let ifd1 = self.next_ifd(self.ifd0()?)?;
        let off = self.scalar(&self.find(ifd1, TAG_THUMB_OFFSET)?)? as usize;
        let len = self.scalar(&self.find(ifd1, TAG_THUMB_LENGTH)?)? as usize;
        (len > 0 && off + len <= self.d.len()).then_some(off..off + len)
    }
}

#[derive(Debug, Clone, Default)]
pub struct JpegHead {
    pub width: u32,
    pub height: u32,
    pub orientation: u16,
    pub thumbnail: Option<Range<usize>>,
}

pub fn parse_head(buf: &[u8]) -> Option<JpegHead> {
    let segs = segments(buf)?;
    let (width, height) = sof_dims(buf, &segs).unwrap_or((0, 0));
    let mut head = JpegHead {
        width,
        height,
        orientation: 1,
        thumbnail: None,
    };
    if let Some(app1) = exif_segment(buf, &segs) {
        let base = app1.payload.start + EXIF_ID.len();
        if let Some(t) = Tiff::new(&buf[base..app1.payload.end]) {
            if let Some((o, _)) = t.orientation().filter(|(o, _)| (1..=8).contains(o)) {
                head.orientation = o;
            }
            head.thumbnail = t.thumbnail().map(|r| base + r.start..base + r.end);
        }
    }
    Some(head)
}

pub fn read_head(path: &Path) -> std::io::Result<Vec<u8>> {
    let mut f = std::fs::File::open(path)?;
    let mut buf = vec![0u8; 256 * 1024];
    let n = read_full(&mut f, &mut buf)?;
    let mut eof = n < buf.len();
    buf.truncate(n);
    while !eof && buf.len() < 4 * 1024 * 1024 {
        let Some(segs) = segments(&buf) else { break };
        if segs
            .last()
            .is_some_and(|s| s.marker == 0xDA && s.payload.end <= buf.len())
        {
            break;
        }
        let old = buf.len();
        buf.resize(old * 2, 0);
        let m = read_full(&mut f, &mut buf[old..])?;
        eof = m < old;
        buf.truncate(old + m);
    }
    Ok(buf)
}

fn read_full(f: &mut impl Read, buf: &mut [u8]) -> std::io::Result<usize> {
    let mut n = 0;
    while n < buf.len() {
        match f.read(&mut buf[n..])? {
            0 => break,
            k => n += k,
        }
    }
    Ok(n)
}

pub fn orientation_app1(o: u16) -> Vec<u8> {
    let mut tiff = vec![b'M', b'M', 0, 42, 0, 0, 0, 8];
    tiff.extend_from_slice(&1u16.to_be_bytes());
    tiff.extend_from_slice(&TAG_ORIENTATION.to_be_bytes());
    tiff.extend_from_slice(&3u16.to_be_bytes());
    tiff.extend_from_slice(&1u32.to_be_bytes());
    tiff.extend_from_slice(&o.to_be_bytes());
    tiff.extend_from_slice(&[0, 0]);
    tiff.extend_from_slice(&0u32.to_be_bytes());
    let mut seg = vec![0xFF, 0xE1];
    seg.extend_from_slice(&((2 + EXIF_ID.len() + tiff.len()) as u16).to_be_bytes());
    seg.extend_from_slice(EXIF_ID);
    seg.extend_from_slice(&tiff);
    seg
}

pub fn with_orientation(jpeg: &[u8], o: u16) -> Option<Vec<u8>> {
    let segs = segments(jpeg)?;
    let mut out = Vec::with_capacity(jpeg.len() + 64);
    out.extend_from_slice(&jpeg[..2]);
    let mut pos = 2;
    let mut inserted = false;
    for s in &segs {
        let is_exif = s.marker == 0xE1 && jpeg[s.payload.clone()].starts_with(EXIF_ID);
        if !inserted && s.marker != 0xE0 {
            if o != 1 {
                out.extend_from_slice(&orientation_app1(o));
            }
            inserted = true;
        }
        if s.marker == 0xDA {
            pos = s.start;
            break;
        }
        if !is_exif {
            out.extend_from_slice(&jpeg[s.start..s.end()]);
        }
        pos = s.end();
    }
    if !inserted && o != 1 {
        out.extend_from_slice(&orientation_app1(o));
    }
    out.extend_from_slice(&jpeg[pos..]);
    Some(out)
}

fn add_orientation_to_exif(tiff_data: &[u8], o: u16) -> Option<Vec<u8>> {
    let t = Tiff::new(tiff_data)?;
    let ifd0 = t.ifd0()?;
    let entries = t.entries(ifd0)?;
    let next = t.u32(ifd0 + 2 + entries.len() * 12)?;
    let mut d = tiff_data.to_vec();
    if d.len() % 2 == 1 {
        d.push(0);
    }
    let new_ifd = d.len();
    let put16 = |v: u16| {
        if t.le {
            v.to_le_bytes()
        } else {
            v.to_be_bytes()
        }
    };
    let put32 = |v: u32| {
        if t.le {
            v.to_le_bytes()
        } else {
            v.to_be_bytes()
        }
    };
    d.extend_from_slice(&put16(entries.len() as u16 + 1));
    let mut ours = Vec::with_capacity(12);
    ours.extend_from_slice(&put16(TAG_ORIENTATION));
    ours.extend_from_slice(&put16(3));
    ours.extend_from_slice(&put32(1));
    ours.extend_from_slice(&put16(o));
    ours.extend_from_slice(&[0, 0]);
    let mut placed = false;
    for e in &entries {
        if !placed && t.tag(e.at) > TAG_ORIENTATION {
            d.extend_from_slice(&ours);
            placed = true;
        }
        d.extend_from_slice(&tiff_data[e.at..e.at + 12]);
    }
    if !placed {
        d.extend_from_slice(&ours);
    }
    d.extend_from_slice(&put32(next));
    d[4..8].copy_from_slice(&put32(new_ifd as u32));
    Some(d)
}

pub fn set_file_orientation(path: &Path, o: u16) -> Result<(), String> {
    let head = read_head(path).map_err(|e| e.to_string())?;
    let segs = segments(&head).ok_or("not a JPEG file")?;
    if !segs.iter().any(|s| s.marker == 0xDA) {
        return Err("JPEG header is too large or truncated".into());
    }
    let app1 = exif_segment(&head, &segs);
    if let Some(app1) = &app1 {
        let base = app1.payload.start + EXIF_ID.len();
        let tiff = Tiff::new(&head[base..app1.payload.end]).ok_or("broken EXIF header")?;
        if let Some((_, at)) = tiff.orientation() {
            let bytes = if tiff.le {
                o.to_le_bytes()
            } else {
                o.to_be_bytes()
            };
            let mut f = std::fs::OpenOptions::new()
                .write(true)
                .open(path)
                .map_err(|e| e.to_string())?;
            f.seek(SeekFrom::Start((base + at) as u64))
                .map_err(|e| e.to_string())?;
            f.write_all(&bytes).map_err(|e| e.to_string())?;
            patch_xmp_orientation(path, &head, &segs, o)?;
            return Ok(());
        }
    }
    let (cut, new_seg) = match &app1 {
        Some(app1) => {
            let base = app1.payload.start + EXIF_ID.len();
            let tiff = add_orientation_to_exif(&head[base..app1.payload.end], o)
                .ok_or("broken EXIF header")?;
            let len = 2 + EXIF_ID.len() + tiff.len();
            if len > 0xFFFF {
                return Err("EXIF segment would exceed 64 KiB".into());
            }
            let mut seg = vec![0xFF, 0xE1];
            seg.extend_from_slice(&(len as u16).to_be_bytes());
            seg.extend_from_slice(EXIF_ID);
            seg.extend_from_slice(&tiff);
            (app1.start..app1.end(), seg)
        }
        None => {
            let at = segs
                .iter()
                .find(|s| s.marker == 0xE0)
                .map(|s| s.end())
                .unwrap_or(2);
            (at..at, orientation_app1(o))
        }
    };
    let data = std::fs::read(path).map_err(|e| e.to_string())?;
    let mut out = Vec::with_capacity(data.len() + new_seg.len());
    out.extend_from_slice(&data[..cut.start]);
    out.extend_from_slice(&new_seg);
    out.extend_from_slice(&data[cut.end..]);
    replace_file(path, &out)
}

fn patch_xmp_orientation(path: &Path, head: &[u8], segs: &[Segment], o: u16) -> Result<(), String> {
    let Some(s) = segs.iter().find(|s| {
        s.marker == 0xE1 && head[s.payload.clone()].starts_with(b"http://ns.adobe.com/xap/1.0/\0")
    }) else {
        return Ok(());
    };
    let p = &head[s.payload.clone()];
    for pat in [&b"tiff:Orientation=\""[..], &b"<tiff:Orientation>"[..]] {
        if let Some(i) = p.windows(pat.len()).position(|w| w == pat) {
            let at = i + pat.len();
            if p.get(at).is_some_and(|c| c.is_ascii_digit())
                && !p.get(at + 1).is_some_and(|c| c.is_ascii_digit())
            {
                let mut f = std::fs::OpenOptions::new()
                    .write(true)
                    .open(path)
                    .map_err(|e| e.to_string())?;
                f.seek(SeekFrom::Start((s.payload.start + at) as u64))
                    .map_err(|e| e.to_string())?;
                f.write_all(&[b'0' + o as u8]).map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(())
}

pub fn replace_file(path: &Path, data: &[u8]) -> Result<(), String> {
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".lpview-tmp");
    let tmp = std::path::PathBuf::from(tmp);
    std::fs::write(&tmp, data).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        e.to_string()
    })
}

pub fn set_tiff_file_orientation(path: &Path, o: u16) -> Result<(), String> {
    let mut f = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut head = vec![0u8; 1 << 20];
    let n = read_full(&mut f, &mut head).map_err(|e| e.to_string())?;
    head.truncate(n);
    let t = Tiff::new(&head).ok_or("not a TIFF file")?;
    let (_, at) = t
        .orientation()
        .ok_or("this TIFF has no orientation tag to change (or its first directory is not in the first MiB)")?;
    let bytes = if t.le {
        o.to_le_bytes()
    } else {
        o.to_be_bytes()
    };
    drop(f);
    let mut f = std::fs::OpenOptions::new()
        .write(true)
        .open(path)
        .map_err(|e| e.to_string())?;
    f.seek(SeekFrom::Start(at as u64))
        .map_err(|e| e.to_string())?;
    f.write_all(&bytes).map_err(|e| e.to_string())
}

pub fn tiff_orientation(head: &[u8]) -> u16 {
    Tiff::new(head)
        .and_then(|t| t.orientation())
        .map(|(o, _)| o)
        .filter(|o| (1..=8).contains(o))
        .unwrap_or(1)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tiny_jpeg(w: u32, h: u32) -> Vec<u8> {
        let p = crate::pixels::Pixels {
            width: w,
            height: h,
            format: crate::pixels::PixFmt::Rgb8,
            data: vec![100; (w * h * 3) as usize],
        };
        p.encode_jpeg(80).unwrap().bytes
    }

    fn with_exif(jpeg: &[u8], tiff: &[u8]) -> Vec<u8> {
        let mut seg = vec![0xFF, 0xE1];
        seg.extend_from_slice(&((2 + 6 + tiff.len()) as u16).to_be_bytes());
        seg.extend_from_slice(EXIF_ID);
        seg.extend_from_slice(tiff);
        let mut out = jpeg[..2].to_vec();
        out.extend_from_slice(&seg);
        out.extend_from_slice(&jpeg[2..]);
        out
    }

    fn tiff_le(orientation: Option<u16>, thumb: &[u8]) -> Vec<u8> {
        let mut d = vec![b'I', b'I', 42, 0, 8, 0, 0, 0];
        let n: u16 = if orientation.is_some() { 2 } else { 1 };
        let ifd0_len = 2 + n as usize * 12 + 4;
        let make_off = 8 + ifd0_len;
        let make = b"Canon\0";
        let ifd1 = make_off + make.len() + 2;
        d.extend_from_slice(&n.to_le_bytes());
        d.extend_from_slice(&0x010Fu16.to_le_bytes());
        d.extend_from_slice(&2u16.to_le_bytes());
        d.extend_from_slice(&(make.len() as u32).to_le_bytes());
        d.extend_from_slice(&(make_off as u32).to_le_bytes());
        if let Some(o) = orientation {
            d.extend_from_slice(&TAG_ORIENTATION.to_le_bytes());
            d.extend_from_slice(&3u16.to_le_bytes());
            d.extend_from_slice(&1u32.to_le_bytes());
            d.extend_from_slice(&o.to_le_bytes());
            d.extend_from_slice(&[0, 0]);
        }
        d.extend_from_slice(&(ifd1 as u32).to_le_bytes());
        d.extend_from_slice(make);
        d.extend_from_slice(&[0, 0]);
        assert_eq!(d.len(), ifd1);
        let thumb_off = ifd1 + 2 + 2 * 12 + 4;
        d.extend_from_slice(&2u16.to_le_bytes());
        for (tag, v) in [
            (TAG_THUMB_OFFSET, thumb_off as u32),
            (TAG_THUMB_LENGTH, thumb.len() as u32),
        ] {
            d.extend_from_slice(&tag.to_le_bytes());
            d.extend_from_slice(&4u16.to_le_bytes());
            d.extend_from_slice(&1u32.to_le_bytes());
            d.extend_from_slice(&v.to_le_bytes());
        }
        d.extend_from_slice(&0u32.to_le_bytes());
        d.extend_from_slice(thumb);
        d
    }

    fn temp_file(name: &str, data: &[u8]) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("lpview-jpeg-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join(name);
        std::fs::write(&p, data).unwrap();
        p
    }

    #[test]
    fn parses_dims_orientation_and_thumbnail() {
        let thumb = tiny_jpeg(16, 8);
        let jpeg = with_exif(&tiny_jpeg(40, 24), &tiff_le(Some(6), &thumb));
        let h = parse_head(&jpeg).unwrap();
        assert_eq!((h.width, h.height, h.orientation), (40, 24, 6));
        assert_eq!(&jpeg[h.thumbnail.unwrap()], &thumb[..]);
        let plain = tiny_jpeg(40, 24);
        let h = parse_head(&plain).unwrap();
        assert_eq!((h.orientation, h.thumbnail.is_none()), (1, true));
        assert!(parse_head(b"not a jpeg").is_none());
    }

    #[test]
    fn injects_orientation() {
        let thumb = tiny_jpeg(16, 8);
        let out = with_orientation(&thumb, 8).unwrap();
        assert_eq!(parse_head(&out).unwrap().orientation, 8);
        let jpeg = with_exif(&tiny_jpeg(16, 8), &tiff_le(Some(3), &thumb));
        let out = with_orientation(&jpeg, 6).unwrap();
        let segs = segments(&out).unwrap();
        assert_eq!(segs.iter().filter(|s| s.marker == 0xE1).count(), 1);
        assert_eq!(parse_head(&out).unwrap().orientation, 6);
        assert_eq!(with_orientation(&thumb, 1).unwrap(), thumb);
    }

    #[test]
    fn patches_existing_tag_in_place() {
        let jpeg = with_exif(&tiny_jpeg(40, 24), &tiff_le(Some(1), &tiny_jpeg(16, 8)));
        let p = temp_file("patch.jpg", &jpeg);
        set_file_orientation(&p, 6).unwrap();
        let after = std::fs::read(&p).unwrap();
        assert_eq!(after.len(), jpeg.len(), "in-place patch keeps the size");
        assert_eq!(parse_head(&after).unwrap().orientation, 6);
        let diff = jpeg.iter().zip(&after).filter(|(a, b)| a != b).count();
        assert_eq!(diff, 1, "only the orientation byte changes");
    }

    #[test]
    fn inserts_tag_into_existing_exif() {
        let thumb = tiny_jpeg(16, 8);
        let jpeg = with_exif(&tiny_jpeg(40, 24), &tiff_le(None, &thumb));
        let p = temp_file("insert.jpg", &jpeg);
        set_file_orientation(&p, 8).unwrap();
        let after = std::fs::read(&p).unwrap();
        let h = parse_head(&after).unwrap();
        assert_eq!(h.orientation, 8);
        assert_eq!(
            &after[h.thumbnail.unwrap()],
            &thumb[..],
            "other offsets stay valid"
        );
        let segs = segments(&after).unwrap();
        let app1 = exif_segment(&after, &segs).unwrap();
        let t = Tiff::new(&after[app1.payload.start + 6..app1.payload.end]).unwrap();
        let make = t.find(t.ifd0().unwrap(), 0x010F).unwrap();
        let off = t.u32(make.at + 8).unwrap() as usize;
        assert_eq!(&t.d[off..off + 5], b"Canon");
        let sos = |b: &[u8]| segments(b).unwrap().last().unwrap().start;
        assert_eq!(&after[sos(&after)..], &jpeg[sos(&jpeg)..]);
    }

    #[test]
    fn inserts_exif_when_missing() {
        let jpeg = tiny_jpeg(40, 24);
        let p = temp_file("noexif.jpg", &jpeg);
        set_file_orientation(&p, 3).unwrap();
        let after = std::fs::read(&p).unwrap();
        assert_eq!(parse_head(&after).unwrap().orientation, 3);
        assert_eq!(parse_head(&after).unwrap().width, 40);
        set_file_orientation(&p, 1).unwrap();
        assert_eq!(
            parse_head(&std::fs::read(&p).unwrap()).unwrap().orientation,
            1
        );
    }

    #[test]
    fn tiff_orientation_patch() {
        let t = tiff_le(Some(1), b"");
        let p = temp_file("x.tif", &t);
        set_tiff_file_orientation(&p, 6).unwrap();
        assert_eq!(tiff_orientation(&std::fs::read(&p).unwrap()), 6);
        let p = temp_file("y.tif", &tiff_le(None, b""));
        assert!(set_tiff_file_orientation(&p, 6).is_err());
    }
}
