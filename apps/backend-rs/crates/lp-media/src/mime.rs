//! `api/mime.py`: MIME type from magic bytes (a port of the image, audio and
//! video matchers of Python `filetype` 1.2.0, in its order), then MPEG-TS
//! sync bytes, then the extension, then `application/octet-stream`.

use std::io::Read;
use std::path::Path;

const SIGNATURE_BYTES: usize = 8192;

fn ftyp_len(buf: &[u8]) -> usize {
    u32::from_be_bytes([buf[0], buf[1], buf[2], buf[3]]) as usize
}

fn is_isobmff(buf: &[u8]) -> bool {
    buf.len() >= 16 && &buf[4..8] == b"ftyp" && buf.len() >= ftyp_len(buf)
}

fn major_brand(buf: &[u8]) -> &[u8] {
    &buf[8..12]
}

fn compatible_brands(buf: &[u8]) -> impl Iterator<Item = &[u8]> {
    let end = ftyp_len(buf).min(buf.len());
    (16..end)
        .step_by(4)
        .map(move |i| &buf[i..(i + 4).min(buf.len())])
}

fn heif_like(buf: &[u8], brand: &[u8]) -> bool {
    if !is_isobmff(buf) {
        return false;
    }
    let major = major_brand(buf);
    major == brand
        || ((major == b"mif1" || major == b"msf1") && compatible_brands(buf).any(|b| b == brand))
}

fn tiff_header(buf: &[u8]) -> bool {
    (buf[0] == 0x49 && buf[1] == 0x49 && buf[2] == 0x2A && buf[3] == 0)
        || (buf[0] == 0x4D && buf[1] == 0x4D && buf[2] == 0 && buf[3] == 0x2A)
}

fn apng(buf: &[u8]) -> bool {
    if buf.len() <= 8 || buf[..8] != [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] {
        return false;
    }
    let mut i = 8usize;
    while buf.len() > i {
        let len_bytes = &buf[i..(i + 4).min(buf.len())];
        let data_length = len_bytes
            .iter()
            .fold(0usize, |acc, &b| acc.wrapping_shl(8) | b as usize);
        i += 4;
        let chunk = if i < buf.len() {
            &buf[i..(i + 4).min(buf.len())]
        } else {
            &[][..]
        };
        i += 4;
        match chunk {
            b"IDAT" | b"IEND" => return false,
            b"acTL" => return true,
            _ => {}
        }
        i = i.saturating_add(data_length).saturating_add(4);
    }
    false
}

fn contains(buf: &[u8], needle: &[u8]) -> bool {
    memchr::memmem::find(buf, needle).is_some()
}

/// `filetype.guess_mime` restricted to images, audio and video.
pub fn sniff(buf: &[u8]) -> Option<&'static str> {
    let n = buf.len();
    let at = |i: usize, v: u8| n > i && buf[i] == v;
    // IMAGE
    if buf.starts_with(&[0x41, 0x43, 0x31, 0x30]) {
        return Some("image/vnd.dwg");
    }
    if buf.starts_with(b"gimp xcf v") {
        return Some("image/x-xcf");
    }
    if n > 2 && buf[0] == 0xFF && buf[1] == 0xD8 && buf[2] == 0xFF {
        return Some("image/jpeg");
    }
    if n > 50 && buf[..4] == [0, 0, 0, 0x0C] && &buf[16..24] == b"ftypjp2 " {
        return Some("image/jpx");
    }
    if apng(buf) {
        return Some("image/apng");
    }
    if n > 3 && buf[..4] == [0x89, 0x50, 0x4E, 0x47] {
        return Some("image/png");
    }
    if n > 2 && buf[..3] == [0x47, 0x49, 0x46] {
        return Some("image/gif");
    }
    if n > 13 && &buf[..4] == b"RIFF" && &buf[8..14] == b"WEBPVP" {
        return Some("image/webp");
    }
    if n > 9 && tiff_header(buf) && !(buf[8] == 0x43 && buf[9] == 0x52) {
        return Some("image/tiff");
    }
    if n > 9 && tiff_header(buf) && buf[8] == 0x43 && buf[9] == 0x52 {
        return Some("image/x-canon-cr2");
    }
    if n > 1 && buf[0] == 0x42 && buf[1] == 0x4D {
        return Some("image/bmp");
    }
    if n > 2 && buf[..3] == [0x49, 0x49, 0xBC] {
        return Some("image/vnd.ms-photo");
    }
    if n > 3 && &buf[..4] == b"8BPS" {
        return Some("image/vnd.adobe.photoshop");
    }
    if n > 3 && buf[..4] == [0, 0, 1, 0] {
        return Some("image/x-icon");
    }
    if heif_like(buf, b"heic") {
        return Some("image/heic");
    }
    if n > 132 && &buf[128..132] == b"DICM" {
        return Some("application/dicom");
    }
    if heif_like(buf, b"avif") {
        return Some("image/avif");
    }
    // AUDIO
    if buf.starts_with(&[0xff, 0xf1]) || buf.starts_with(&[0xff, 0xf9]) {
        return Some("audio/aac");
    }
    if n > 3 && &buf[..4] == b"MThd" {
        return Some("audio/midi");
    }
    if n > 2
        && (&buf[..3] == b"ID3"
            || (buf[0] == 0xFF && (buf[1] == 0xF2 || buf[1] == 0xF3 || buf[1] == 0xFB)))
    {
        return Some("audio/mpeg");
    }
    if n > 10 && (&buf[4..11] == b"ftypM4A" || &buf[..4] == b"M4A ") {
        return Some("audio/mp4");
    }
    if n > 3 && &buf[..4] == b"OggS" {
        return Some("audio/ogg");
    }
    if n > 3 && &buf[..4] == b"fLaC" {
        return Some("audio/x-flac");
    }
    if n > 11 && &buf[..4] == b"RIFF" && &buf[8..12] == b"WAVE" {
        return Some("audio/x-wav");
    }
    if n > 11 && &buf[..6] == b"#!AMR\n" {
        return Some("audio/amr");
    }
    if n > 11 && &buf[..4] == b"FORM" && &buf[8..12] == b"AIFF" {
        return Some("audio/x-aiff");
    }
    // VIDEO
    if buf.starts_with(b"ftyp3gp") {
        return Some("video/3gpp");
    }
    if is_isobmff(buf) {
        let mp4 = |b: &[u8]| b == b"mp41" || b == b"mp42" || b == b"isom";
        if compatible_brands(buf).any(mp4) || mp4(major_brand(buf)) {
            return Some("video/mp4");
        }
    }
    if n > 10 && buf[..4] == [0, 0, 0, 0x1C] && &buf[4..11] == b"ftypM4V" {
        return Some("video/x-m4v");
    }
    let ebml = buf.starts_with(&[0x1A, 0x45, 0xDF, 0xA3]);
    if ebml && contains(buf, b"\x42\x82\x88matroska") {
        return Some("video/x-matroska");
    }
    if is_isobmff(buf) && major_brand(buf) == b"qt  " {
        return Some("video/quicktime");
    }
    if n > 11 && &buf[..4] == b"RIFF" && &buf[8..12] == b"AVI " {
        return Some("video/x-msvideo");
    }
    if n > 9 && buf[..10] == [0x30, 0x26, 0xB2, 0x75, 0x8E, 0x66, 0xCF, 0x11, 0xA6, 0xD9] {
        return Some("video/x-ms-wmv");
    }
    if n > 3 && buf[..3] == [0, 0, 1] && (0xb0..=0xbf).contains(&buf[3]) {
        return Some("video/mpeg");
    }
    if ebml && contains(buf, b"\x42\x82\x84webm") {
        return Some("video/webm");
    }
    if n > 3 && at(0, 0x46) && buf[1] == 0x4C && buf[2] == 0x56 && buf[3] == 0x01 {
        return Some("video/x-flv");
    }
    None
}

fn is_mpeg_ts(head: &[u8]) -> bool {
    head.len() == 192 * 3
        && ([0usize, 188, 376].iter().all(|&i| head[i] == 0x47)
            || [4usize, 196, 388].iter().all(|&i| head[i] == 0x47))
}

fn read_head(path: &Path, max: usize) -> std::io::Result<Vec<u8>> {
    let mut buf = Vec::with_capacity(max);
    std::fs::File::open(path)?
        .take(max as u64)
        .read_to_end(&mut buf)?;
    Ok(buf)
}

/// `sniffed_mime_type`: from the file's first bytes, or None.
pub fn sniffed_mime_type(path: &Path) -> Option<&'static str> {
    let head = read_head(path, SIGNATURE_BYTES).ok()?;
    sniff(&head).or_else(|| {
        let ts = &head[..head.len().min(192 * 3)];
        is_mpeg_ts(ts).then_some("video/mp2t")
    })
}

/// `mimetypes.guess_type(path)[0]`, approximated by `mime_guess`.
pub fn guess_from_extension(path: &Path) -> Option<String> {
    mime_guess::from_path(path)
        .first_raw()
        .map(|m| m.to_string())
}

/// `api.mime.mime_type`: magic bytes, else extension, else octet-stream.
/// Blocking (reads the file head).
pub fn mime_type(path: &Path) -> String {
    sniffed_mime_type(path)
        .map(str::to_string)
        .or_else(|| guess_from_extension(path))
        .unwrap_or_else(|| "application/octet-stream".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ftyp(major: &[u8; 4], compat: &[&[u8; 4]]) -> Vec<u8> {
        let len = 16 + 4 * compat.len();
        let mut v = (len as u32).to_be_bytes().to_vec();
        v.extend_from_slice(b"ftyp");
        v.extend_from_slice(major);
        v.extend_from_slice(&[0, 0, 0, 0]);
        for c in compat {
            v.extend_from_slice(*c);
        }
        v.extend_from_slice(&[0u8; 32]);
        v
    }

    #[test]
    fn isobmff_brands() {
        assert_eq!(
            sniff(&ftyp(b"isom", &[b"isom", b"avc1"])),
            Some("video/mp4")
        );
        assert_eq!(sniff(&ftyp(b"qt  ", &[b"qt  "])), Some("video/quicktime"));
        assert_eq!(sniff(&ftyp(b"heic", &[b"mif1"])), Some("image/heic"));
        assert_eq!(sniff(&ftyp(b"mif1", &[b"heic"])), Some("image/heic"));
        assert_eq!(sniff(&ftyp(b"avif", &[])), Some("image/avif"));
        assert_eq!(sniff(&ftyp(b"M4A ", &[b"isom"])), Some("audio/mp4"));
        assert_eq!(sniff(&ftyp(b"mif1", &[b"miaf"])), None);
    }

    #[test]
    fn classic_magic() {
        assert_eq!(sniff(&[0xFF, 0xD8, 0xFF, 0xE0]), Some("image/jpeg"));
        assert_eq!(
            sniff(&[
                0x89, 0x50, 0x4E, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, b'I', b'H', b'D', b'R'
            ]),
            Some("image/png")
        );
        let mut webp = b"RIFF\0\0\0\0WEBPVP8 ".to_vec();
        webp.extend_from_slice(&[0; 8]);
        assert_eq!(sniff(&webp), Some("image/webp"));
        let mut tiff = vec![0x49, 0x49, 0x2A, 0, 8, 0, 0, 0, 0, 0];
        assert_eq!(sniff(&tiff), Some("image/tiff"));
        tiff[8] = 0x43;
        tiff[9] = 0x52;
        assert_eq!(sniff(&tiff), Some("image/x-canon-cr2"));
        assert_eq!(sniff(b"hello"), None);
        let mut ts = vec![0u8; 576];
        ts[0] = 0x47;
        ts[188] = 0x47;
        ts[376] = 0x47;
        assert!(is_mpeg_ts(&ts));
    }
}
