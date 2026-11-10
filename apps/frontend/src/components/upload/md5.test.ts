/**
 * Our MD5 against the RFC 1321 test suite, Node's MD5 at every length around the block and padding
 * boundaries, and digests crypto-js 4.2.0 (which the upload used before) gave for the same bytes.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { bitLength, Md5 } from "./md5";

const md5 = (...parts: Uint8Array[]) => parts.reduce((hash, part) => hash.update(part), new Md5()).digest();
const text = (value: string) => new TextEncoder().encode(value);

/** xorshift32 bytes: the buffers the crypto-js digests below were taken from. */
function bytes(length: number, seed: number): Uint8Array {
  const out = new Uint8Array(length);
  let x = seed >>> 0 || 1;
  for (let i = 0; i < length; i++) {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    out[i] = x & 0xff;
  }
  return out;
}

describe("Md5", () => {
  it.each([
    ["", "d41d8cd98f00b204e9800998ecf8427e"],
    ["a", "0cc175b9c0f1b6a831c399e269772661"],
    ["abc", "900150983cd24fb0d6963f7d28e17f72"],
    ["message digest", "f96b697d7cb7938d525a2f31aaf161d0"],
    ["abcdefghijklmnopqrstuvwxyz", "c3fcd3d76192e4007dfb496cca67e13b"],
    ["ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789", "d174ab98d277d9f5a5611c2c9f419d9f"],
    [
      "12345678901234567890123456789012345678901234567890123456789012345678901234567890",
      "57edf4a22be3c955ac49da2e2107b67a",
    ],
  ])("hashes the RFC 1321 vector %j", (input, digest) => {
    expect(md5(text(input))).toBe(digest);
  });

  it("matches Node's MD5 at every length around the block and padding boundaries", () => {
    for (const length of [0, 1, 55, 56, 57, 63, 64, 65, 119, 120, 121, 127, 128, 129, 1000]) {
      const input = bytes(length, length + 1);
      expect(md5(input), `${length} bytes`).toBe(createHash("md5").update(input).digest("hex"));
    }
  });

  it("gives the same digest however the input is split", () => {
    const input = bytes(4099, 42);
    const whole = md5(input);
    for (const size of [1, 3, 63, 64, 65, 1000, 4098]) {
      const parts: Uint8Array[] = [];
      for (let offset = 0; offset < input.length; offset += size) parts.push(input.subarray(offset, offset + size));
      expect(md5(...parts), `pieces of ${size}`).toBe(whole);
    }
    // Empty pieces change nothing either.
    expect(md5(new Uint8Array(0), input, new Uint8Array(0))).toBe(whole);
  });

  it("reads a view at any offset of its buffer", () => {
    const backing = bytes(300, 9);
    expect(md5(backing.subarray(3, 203))).toBe(createHash("md5").update(backing.subarray(3, 203)).digest("hex"));
  });

  it.each([
    [1, 1, "9033e0e305f247c0c3c80d0c7848c8b3"],
    [63, 2, "4594633dbd476ccfa5e19a599bd32530"],
    [64, 3, "0a72c6eb9c2c2c97f0dc7efd97777c10"],
    [65, 4, "28f5489fff1d15cab26292c1061dc09d"],
    [1000, 5, "a20c6253f5bd8ce0ad191451c1b8d534"],
    [65543, 6, "6d5f6ba4ddc569190f0d12017c2a4a26"],
    [1000003, 7, "353a58fc1d915bc6ad16d91b92c60c33"],
  ])("gives crypto-js's digest for %i random bytes (seed %i)", (length, seed, digest) => {
    const input = bytes(length, seed);
    const parts: Uint8Array[] = [];
    for (let offset = 0; offset < length; offset += 4096) parts.push(input.subarray(offset, offset + 4096));
    expect(md5(...parts)).toBe(digest);
  });

  it("takes no input after its digest", () => {
    const hash = new Md5().update(text("abc"));
    expect(hash.digest()).toBe("900150983cd24fb0d6963f7d28e17f72");
    expect(hash.digest()).toBe("900150983cd24fb0d6963f7d28e17f72");
    expect(() => hash.update(text("d"))).toThrow();
  });
});

describe("bitLength", () => {
  it("splits the length in bits into MD5's two 32-bit words, past 4 GB too", () => {
    expect(bitLength(0)).toEqual([0, 0]);
    expect(bitLength(3)).toEqual([24, 0]);
    expect(bitLength(2 ** 29 - 1)).toEqual([2 ** 32 - 8, 0]);
    expect(bitLength(2 ** 29)).toEqual([0, 1]);
    // A 4 GB + 5 byte video: 2^35 + 40 bits.
    expect(bitLength(2 ** 32 + 5)).toEqual([40, 8]);
    // 100 GB.
    expect(bitLength(100 * 2 ** 30)).toEqual([0, 200]);
  });
});
