import { describe, expect, it } from "vitest";
import { qrSquares, qrSvgDataUrl } from "./qrMatrix";

const SHARE_URL = "https://photos.example.com/public/p/AbCdEfGhIjKl";
const QUIET_ZONE = 4;
const ECC_M_FORMAT_BITS = 0;

function darkModules(path: string): Set<string> {
  const squares = [...path.matchAll(/M(\d+) (\d+)h1v1h-1z/g)].map(([, x, y]) => `${x},${y}`);
  expect(path).toBe(squares.map(square => `M${square.replace(",", " ")}h1v1h-1z`).join(""));
  return new Set(squares);
}

function formatWord(eccBits: number, mask: number): number {
  const data = (eccBits << 3) | mask;
  let remainder = data;
  for (let i = 0; i < 10; i++) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
  return ((data << 10) | (remainder & 0x3ff)) ^ 0x5412;
}

function readFormatCopies(dark: (x: number, y: number) => boolean, size: number): [number, number] {
  const bit = (on: boolean, index: number) => (on ? 1 << index : 0);
  let first = 0;
  for (let i = 0; i <= 5; i++) first |= bit(dark(8, i), i);
  first |= bit(dark(8, 7), 6) | bit(dark(8, 8), 7) | bit(dark(7, 8), 8);
  for (let i = 9; i < 15; i++) first |= bit(dark(14 - i, 8), i);
  let second = 0;
  for (let i = 0; i < 8; i++) second |= bit(dark(size - 1 - i, 8), i);
  for (let i = 8; i < 15; i++) second |= bit(dark(8, size - 15 + i), i);
  return [first, second];
}

function decodeLayout(value: string) {
  const { path, side } = qrSquares(value);
  const modules = darkModules(path);
  const size = side - QUIET_ZONE * 2;
  const dark = (x: number, y: number) => modules.has(`${x + QUIET_ZONE},${y + QUIET_ZONE}`);
  return { modules, side, size, dark };
}

describe("qrSquares", () => {
  it("keeps a quiet zone of four light modules on every side", () => {
    const { modules, side } = decodeLayout(SHARE_URL);
    for (const square of modules) {
      const [x = -1, y = -1] = square.split(",").map(Number);
      expect(x).toBeGreaterThanOrEqual(QUIET_ZONE);
      expect(y).toBeGreaterThanOrEqual(QUIET_ZONE);
      expect(x).toBeLessThan(side - QUIET_ZONE);
      expect(y).toBeLessThan(side - QUIET_ZONE);
    }
    expect([...modules].some(square => square.startsWith(`${QUIET_ZONE},`))).toBe(true);
    expect([...modules].some(square => square.endsWith(`,${side - QUIET_ZONE - 1}`))).toBe(true);
  });

  it("draws a whole symbol with a finder pattern in three corners", () => {
    const { size, dark } = decodeLayout(SHARE_URL);
    expect((size - 17) % 4).toBe(0);
    for (const [left, top] of [
      [0, 0],
      [size - 7, 0],
      [0, size - 7],
    ] as const) {
      for (let i = 0; i < 7; i++) {
        expect(dark(left + i, top)).toBe(true);
        expect(dark(left + i, top + 6)).toBe(true);
        expect(dark(left, top + i)).toBe(true);
        expect(dark(left + 6, top + i)).toBe(true);
      }
      expect(dark(left + 1, top + 1)).toBe(false);
      expect(dark(left + 3, top + 3)).toBe(true);
    }
  });

  it("encodes at error correction level M, in both copies of the format information", () => {
    const { size, dark } = decodeLayout(SHARE_URL);
    const [first, second] = readFormatCopies(dark, size);
    expect(first).toBe(second);
    const masks = [0, 1, 2, 3, 4, 5, 6, 7].filter(mask => formatWord(ECC_M_FORMAT_BITS, mask) === first);
    expect(masks).toHaveLength(1);
  });

  it("grows the symbol for a long link instead of failing", () => {
    const short = decodeLayout(SHARE_URL);
    const long = decodeLayout(`https://photos.example.com/librephotos/public/s/${"a".repeat(120)}?slideshow=1`);
    expect(long.size).toBeGreaterThan(short.size);
    expect((long.size - 17) % 4).toBe(0);
  });

  it("gives a different code for a different link", () => {
    expect(qrSquares(`${SHARE_URL}x`).path).not.toBe(qrSquares(SHARE_URL).path);
  });
});

describe("qrSvgDataUrl", () => {
  it("is a standalone black-on-white SVG file of the same squares", () => {
    const squares = qrSquares(SHARE_URL);
    const url = qrSvgDataUrl(squares);
    const prefix = "data:image/svg+xml;charset=utf-8,";
    expect(url.startsWith(prefix)).toBe(true);
    const svg = decodeURIComponent(url.slice(prefix.length));
    const parsed = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement;
    expect(parsed.getAttribute("viewBox")).toBe(`0 0 ${squares.side} ${squares.side}`);
    expect(parsed.getAttribute("width")).toBe(String(squares.side * 10));
    expect(parsed.querySelector("rect")?.getAttribute("fill")).toBe("white");
    expect(parsed.querySelector("path")?.getAttribute("fill")).toBe("black");
    expect(parsed.querySelector("path")?.getAttribute("d")).toBe(squares.path);
  });
});
