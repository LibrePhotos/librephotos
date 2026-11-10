/**
 * MD5 (RFC 1321), fed in pieces: the digest the chunked upload sends, which the server compares with
 * the MD5 of the file it assembled (apps/backend/chunked_upload). Works on bytes as they come from
 * `Blob.arrayBuffer()`, with no copy into a string, and counts the length in a float, exact up to
 * 2^53 bytes, so files over 4 GB hash right.
 */

/** Each round's four left rotations, repeated over its 16 steps. */
const ROUND_SHIFTS = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
/** The left rotation of each of the 64 steps. */
const SHIFTS = Int32Array.from({ length: 64 }, (_unused, i) => ROUND_SHIFTS[(i >> 4) * 4 + (i & 3)] ?? 0);

/** floor(abs(sin(i + 1)) * 2^32), as signed 32-bit integers. */
const SINES = Int32Array.from({ length: 64 }, (_unused, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) | 0);

const BLOCK = 64;

/**
 * The message length in bits as MD5 appends it, low and high 32-bit words: exact for any length a
 * float counts exactly (2^53 bytes), so a file over 4 GB (2^29 bytes * 8 = 2^32 bits) hashes right.
 */
export function bitLength(bytes: number): [low: number, high: number] {
  return [(bytes % 0x20000000) * 8, Math.floor(bytes / 0x20000000)];
}

export class Md5 {
  private readonly state = Int32Array.of(0x67452301, 0xefcdab89 | 0, 0x98badcfe | 0, 0x10325476);
  /** The bytes of an unfinished block. */
  private readonly tail = new Uint8Array(BLOCK);
  private tailLength = 0;
  /** Bytes hashed so far. */
  private length = 0;
  private readonly tailView = new DataView(this.tail.buffer);
  private readonly words = new Int32Array(16);
  private done = false;

  /** Adds bytes; any split of the input gives the same digest. */
  update(bytes: Uint8Array): this {
    if (this.done) throw new Error("MD5: update after digest");
    this.length += bytes.length;
    let offset = 0;
    if (this.tailLength > 0) {
      const take = Math.min(BLOCK - this.tailLength, bytes.length);
      this.tail.set(bytes.subarray(0, take), this.tailLength);
      this.tailLength += take;
      offset = take;
      if (this.tailLength < BLOCK) return this;
      this.block(this.tailView, 0);
      this.tailLength = 0;
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (; offset + BLOCK <= bytes.length; offset += BLOCK) this.block(view, offset);
    if (offset < bytes.length) {
      this.tail.set(bytes.subarray(offset));
      this.tailLength = bytes.length - offset;
    }
    return this;
  }

  /** The digest as 32 lowercase hex digits; the hash takes no more input after it. */
  digest(): string {
    if (!this.done) {
      this.done = true;
      const [bitsLow, bitsHigh] = bitLength(this.length);
      const tail = this.tail;
      tail[this.tailLength] = 0x80;
      tail.fill(0, this.tailLength + 1);
      if (this.tailLength >= 56) {
        this.block(this.tailView, 0);
        tail.fill(0);
      }
      this.tailView.setUint32(56, bitsLow, true);
      this.tailView.setUint32(60, bitsHigh, true);
      this.block(this.tailView, 0);
    }
    let hex = "";
    for (const word of this.state) {
      for (let shift = 0; shift < 32; shift += 8) hex += ((word >>> shift) & 0xff).toString(16).padStart(2, "0");
    }
    return hex;
  }

  /** One 64-byte block at `offset` of `view`, read as 16 little-endian words. */
  private block(view: DataView, offset: number) {
    const x = this.words;
    for (let i = 0; i < 16; i++) x[i] = view.getInt32(offset + i * 4, true);
    const state = this.state;
    let a = state[0] ?? 0;
    let b = state[1] ?? 0;
    let c = state[2] ?? 0;
    let d = state[3] ?? 0;
    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) & 15;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) & 15;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) & 15;
      }
      const shift = SHIFTS[i] ?? 0;
      const sum = (a + f + (SINES[i] ?? 0) + (x[g] ?? 0)) | 0;
      a = d;
      d = c;
      c = b;
      b = (b + ((sum << shift) | (sum >>> (32 - shift)))) | 0;
    }
    state[0] = ((state[0] ?? 0) + a) | 0;
    state[1] = ((state[1] ?? 0) + b) | 0;
    state[2] = ((state[2] ?? 0) + c) | 0;
    state[3] = ((state[3] ?? 0) + d) | 0;
  }
}
