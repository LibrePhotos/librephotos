// django-cryptography `encrypt(CharField)` columns (User.nextcloud_app_password,
// the SMTP secret): pickle.dumps(str) encrypted with a Fernet variant. Port of
// lp_core::django_crypto.
//
// Layout: 0x80 | u64 BE timestamp | 16-byte IV | AES-256-CBC(PKCS7) | HMAC-SHA256.
// AES key = PBKDF2-HMAC-SHA256(SECRET_KEY, "django-cryptography", 30000, 32);
// the HMAC key is SECRET_KEY itself and covers everything before it. Rows we
// write must decrypt in Django (NOT NULL bytea, even for "").
import { createCipheriv, createDecipheriv, createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";
import { config } from "~/lib/config";

let aesKey: Buffer | null = null;
/** The derived key, computed once per process (30000 PBKDF2 rounds). */
function key(): Buffer {
  aesKey ??= pbkdf2Sync(config.secretKey, "django-cryptography", 30000, 32, "sha256");
  return aesKey;
}

/** pickle.dumps(s) (protocol 4, CPython's default) for a str. */
function pickleStr(s: string): Buffer {
  const data = Buffer.from(s, "utf8");
  const head = data.length < 256 ? Buffer.from([0x8c, data.length]) : Buffer.concat([Buffer.from([0x58]), u32le(data.length)]);
  const body = Buffer.concat([head, data, Buffer.from([0x94, 0x2e])]);
  const frame = Buffer.alloc(9);
  frame[0] = 0x95;
  frame.writeBigUInt64LE(BigInt(body.length), 1);
  return Buffer.concat([Buffer.from([0x80, 0x04]), frame, body]);
}

function u32le(n: number) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
}

function unpickleStr(p: Buffer): string | null {
  let i = 0;
  if (p[i] === 0x80) i += 2;
  if (p[i] === 0x95) i += 9;
  let len: number;
  let start: number;
  if (p[i] === 0x8c) {
    if (i + 1 >= p.length) return null;
    len = p[i + 1];
    start = i + 2;
  } else if (p[i] === 0x58) {
    if (i + 5 > p.length) return null;
    len = p.readUInt32LE(i + 1);
    start = i + 5;
  } else return null;
  if (start + len > p.length) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(p.subarray(start, start + len));
  } catch {
    return null;
  }
}

export function encryptStr(value: string): Buffer {
  const iv = randomBytes(16);
  const ts = Buffer.alloc(8);
  ts.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000)));
  const c = createCipheriv("aes-256-cbc", key(), iv);
  const ct = Buffer.concat([c.update(pickleStr(value)), c.final()]);
  const signed = Buffer.concat([Buffer.from([0x80]), ts, iv, ct]);
  const mac = createHmac("sha256", config.secretKey).update(signed).digest();
  return Buffer.concat([signed, mac]);
}

/** The plaintext, or null for a token that does not verify/decrypt. */
export function decryptStr(token: Uint8Array | null | undefined): string | null {
  if (!token) return null;
  const t = Buffer.from(token);
  if (t.length < 1 + 8 + 16 + 16 + 32 || t[0] !== 0x80) return null;
  const signed = t.subarray(0, t.length - 32);
  const sig = t.subarray(t.length - 32);
  const want = createHmac("sha256", config.secretKey).update(signed).digest();
  if (!timingSafeEqual(want, sig)) return null;
  try {
    const d = createDecipheriv("aes-256-cbc", key(), signed.subarray(9, 25));
    return unpickleStr(Buffer.concat([d.update(signed.subarray(25)), d.final()]));
  } catch {
    return null;
  }
}
