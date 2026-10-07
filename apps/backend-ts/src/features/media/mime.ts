// api/mime.py (port of lp_media::mime): MIME type from magic bytes (the
// image, audio and video matchers of Python `filetype` 1.2.0, in its order),
// then MPEG-TS sync bytes, then the extension, then application/octet-stream.
import { closeSync, openSync, readSync } from "node:fs";

const SIGNATURE_BYTES = 8192;
const ascii = (buf: Uint8Array, start: number, s: string) => {
  if (buf.length < start + s.length) return false;
  for (let i = 0; i < s.length; i++) if (buf[start + i] !== s.charCodeAt(i)) return false;
  return true;
};
const bytesAt = (buf: Uint8Array, start: number, bs: number[]) => {
  if (buf.length < start + bs.length) return false;
  for (let i = 0; i < bs.length; i++) if (buf[start + i] !== bs[i]) return false;
  return true;
};

const ftypLen = (b: Uint8Array) => ((b[0]! << 24) >>> 0) + (b[1]! << 16) + (b[2]! << 8) + b[3]!;
const isIsobmff = (b: Uint8Array) => b.length >= 16 && ascii(b, 4, "ftyp") && b.length >= ftypLen(b);
const majorBrand = (b: Uint8Array) => String.fromCharCode(b[8]!, b[9]!, b[10]!, b[11]!);

function compatibleBrands(b: Uint8Array): string[] {
  const end = Math.min(ftypLen(b), b.length);
  const out: string[] = [];
  for (let i = 16; i < end; i += 4) out.push(String.fromCharCode(...b.subarray(i, Math.min(i + 4, b.length))));
  return out;
}

function heifLike(b: Uint8Array, brand: string): boolean {
  if (!isIsobmff(b)) return false;
  const major = majorBrand(b);
  return major === brand || ((major === "mif1" || major === "msf1") && compatibleBrands(b).includes(brand));
}

const tiffHeader = (b: Uint8Array) => bytesAt(b, 0, [0x49, 0x49, 0x2a, 0]) || bytesAt(b, 0, [0x4d, 0x4d, 0, 0x2a]);

function apng(b: Uint8Array): boolean {
  if (b.length <= 8 || !bytesAt(b, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return false;
  let i = 8;
  while (b.length > i) {
    let dataLength = 0;
    for (const x of b.subarray(i, Math.min(i + 4, b.length))) dataLength = dataLength * 256 + x;
    i += 4;
    const chunk = i < b.length ? String.fromCharCode(...b.subarray(i, Math.min(i + 4, b.length))) : "";
    i += 4;
    if (chunk === "IDAT" || chunk === "IEND") return false;
    if (chunk === "acTL") return true;
    i += dataLength + 4;
  }
  return false;
}

function contains(b: Uint8Array, needle: number[]): boolean {
  outer: for (let i = 0; i + needle.length <= b.length; i++) {
    for (let j = 0; j < needle.length; j++) if (b[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}
const str = (s: string) => [...s].map((c) => c.charCodeAt(0));

/** filetype.guess_mime restricted to images, audio and video. */
export function sniff(b: Uint8Array): string | undefined {
  const n = b.length;
  // IMAGE
  if (bytesAt(b, 0, [0x41, 0x43, 0x31, 0x30])) return "image/vnd.dwg";
  if (ascii(b, 0, "gimp xcf v")) return "image/x-xcf";
  if (n > 2 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (n > 50 && bytesAt(b, 0, [0, 0, 0, 0x0c]) && ascii(b, 16, "ftypjp2 ")) return "image/jpx";
  if (apng(b)) return "image/apng";
  if (n > 3 && bytesAt(b, 0, [0x89, 0x50, 0x4e, 0x47])) return "image/png";
  if (n > 2 && bytesAt(b, 0, [0x47, 0x49, 0x46])) return "image/gif";
  if (n > 13 && ascii(b, 0, "RIFF") && ascii(b, 8, "WEBPVP")) return "image/webp";
  if (n > 9 && tiffHeader(b) && !(b[8] === 0x43 && b[9] === 0x52)) return "image/tiff";
  if (n > 9 && tiffHeader(b) && b[8] === 0x43 && b[9] === 0x52) return "image/x-canon-cr2";
  if (n > 1 && b[0] === 0x42 && b[1] === 0x4d) return "image/bmp";
  if (n > 2 && bytesAt(b, 0, [0x49, 0x49, 0xbc])) return "image/vnd.ms-photo";
  if (n > 3 && ascii(b, 0, "8BPS")) return "image/vnd.adobe.photoshop";
  if (n > 3 && bytesAt(b, 0, [0, 0, 1, 0])) return "image/x-icon";
  if (heifLike(b, "heic")) return "image/heic";
  if (n > 132 && ascii(b, 128, "DICM")) return "application/dicom";
  if (heifLike(b, "avif")) return "image/avif";
  // AUDIO
  if (bytesAt(b, 0, [0xff, 0xf1]) || bytesAt(b, 0, [0xff, 0xf9])) return "audio/aac";
  if (n > 3 && ascii(b, 0, "MThd")) return "audio/midi";
  if (n > 2 && (ascii(b, 0, "ID3") || (b[0] === 0xff && (b[1] === 0xf2 || b[1] === 0xf3 || b[1] === 0xfb)))) return "audio/mpeg";
  if (n > 10 && (ascii(b, 4, "ftypM4A") || ascii(b, 0, "M4A "))) return "audio/mp4";
  if (n > 3 && ascii(b, 0, "OggS")) return "audio/ogg";
  if (n > 3 && ascii(b, 0, "fLaC")) return "audio/x-flac";
  if (n > 11 && ascii(b, 0, "RIFF") && ascii(b, 8, "WAVE")) return "audio/x-wav";
  if (n > 11 && ascii(b, 0, "#!AMR\n")) return "audio/amr";
  if (n > 11 && ascii(b, 0, "FORM") && ascii(b, 8, "AIFF")) return "audio/x-aiff";
  // VIDEO
  if (ascii(b, 0, "ftyp3gp")) return "video/3gpp";
  if (isIsobmff(b)) {
    const mp4 = (x: string) => x === "mp41" || x === "mp42" || x === "isom";
    if (compatibleBrands(b).some(mp4) || mp4(majorBrand(b))) return "video/mp4";
  }
  if (n > 10 && bytesAt(b, 0, [0, 0, 0, 0x1c]) && ascii(b, 4, "ftypM4V")) return "video/x-m4v";
  const ebml = bytesAt(b, 0, [0x1a, 0x45, 0xdf, 0xa3]);
  if (ebml && contains(b, [0x42, 0x82, 0x88, ...str("matroska")])) return "video/x-matroska";
  if (isIsobmff(b) && majorBrand(b) === "qt  ") return "video/quicktime";
  if (n > 11 && ascii(b, 0, "RIFF") && ascii(b, 8, "AVI ")) return "video/x-msvideo";
  if (n > 9 && bytesAt(b, 0, [0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11, 0xa6, 0xd9])) return "video/x-ms-wmv";
  if (n > 3 && bytesAt(b, 0, [0, 0, 1]) && b[3]! >= 0xb0 && b[3]! <= 0xbf) return "video/mpeg";
  if (ebml && contains(b, [0x42, 0x82, 0x84, ...str("webm")])) return "video/webm";
  if (n > 3 && b[0] === 0x46 && b[1] === 0x4c && b[2] === 0x56 && b[3] === 0x01) return "video/x-flv";
  return undefined;
}

function isMpegTs(head: Uint8Array): boolean {
  return (
    head.length === 192 * 3 &&
    ([0, 188, 376].every((i) => head[i] === 0x47) || [4, 196, 388].every((i) => head[i] === 0x47))
  );
}

function readHead(path: string, max: number): Uint8Array | undefined {
  let fd: number | undefined;
  try {
    fd = openSync(path, "r");
    const buf = new Uint8Array(max);
    let got = 0;
    while (got < max) {
      const n = readSync(fd, buf, got, max - got, got);
      if (n <= 0) break;
      got += n;
    }
    return buf.subarray(0, got);
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** sniffed_mime_type: from the file's first bytes, or undefined. */
export function sniffedMimeType(path: string): string | undefined {
  const head = readHead(path, SIGNATURE_BYTES);
  if (!head) return undefined;
  return sniff(head) ?? (isMpegTs(head.subarray(0, Math.min(head.length, 192 * 3))) ? "video/mp2t" : undefined);
}

/** mimetypes.guess_type(path)[0], approximated by Bun's extension table. */
export function guessFromExtension(path: string): string | undefined {
  const t = Bun.file(path).type;
  if (!t || t === "application/octet-stream") return undefined;
  return t.replace(/;charset=utf-8$/i, "");
}

/** api.mime.mime_type: magic bytes, else extension, else octet-stream. */
export function mimeType(path: string): string {
  return sniffedMimeType(path) ?? guessFromExtension(path) ?? "application/octet-stream";
}
