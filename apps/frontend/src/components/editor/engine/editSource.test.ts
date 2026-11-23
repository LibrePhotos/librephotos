import { describe, expect, it } from "vitest";
import { defined } from "../../../util/defined.test-utils";
import { EditSourceError, inflate, linear16Pixels, loadEditSource, parseEditSourceFile } from "./editSource";

/** An edit source file of hand-made parts. */
function lpes(kind: number, header: Record<string, unknown>, payload: Uint8Array, version = 1): ArrayBuffer {
  const json = new TextEncoder().encode(JSON.stringify(header));
  const bytes = new Uint8Array(12 + json.length + payload.length);
  bytes.set(new TextEncoder().encode("LPES"), 0);
  bytes[4] = version;
  bytes[5] = kind;
  new DataView(bytes.buffer).setUint32(8, json.length, true);
  bytes.set(json, 12);
  bytes.set(payload, 12 + json.length);
  return bytes.buffer;
}

const header = (kind: string, width: number, height: number, max: number) => ({
  kind,
  width,
  height,
  full_width: width * 4,
  full_height: height * 4,
  max,
});

async function deflate(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  }).pipeThrough(new CompressionStream("deflate"));
  const out: number[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out.push(...value);
  }
  return new Uint8Array(out);
}

/** The six delta-coded planes of a linear16 payload for `values[channel][pixel]` (u, low bits cleared). */
function planesOf(values: number[][], width: number, height: number): Uint8Array<ArrayBuffer> {
  const count = width * height;
  const planes = new Uint8Array(count * 6);
  values.forEach((channel, c) => {
    for (let row = 0; row < height; row++) {
      let left = 0;
      for (let x = 0; x < width; x++) {
        const i = row * width + x;
        const u = defined(channel[i]);
        const d = (u - left + 65536) % 65536;
        left = u;
        planes[c * 2 * count + i] = d >> 8;
        planes[(c * 2 + 1) * count + i] = d & 0xff;
      }
    }
  });
  return planes;
}

describe("edit source file", () => {
  it("splits an srgb8 file into its header and the JPEG", () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const file = parseEditSourceFile(lpes(0, header("srgb8", 2560, 1707, 1), jpeg));
    expect(file.header).toEqual(header("srgb8", 2560, 1707, 1));
    expect([...file.payload]).toEqual([...jpeg]);
  });

  it.each([
    ["another magic", () => new TextEncoder().encode("JPEG00000000").buffer],
    ["another format version", () => lpes(0, header("srgb8", 2, 2, 1), new Uint8Array(), 2)],
    ["an unknown kind", () => lpes(7, header("srgb8", 2, 2, 1), new Uint8Array())],
    ["a header of the other kind", () => lpes(1, header("srgb8", 2, 2, 1), new Uint8Array())],
    ["a header without a size", () => lpes(0, { kind: "srgb8", max: 1 }, new Uint8Array())],
    ["a truncated file", () => lpes(0, header("srgb8", 2, 2, 1), new Uint8Array()).slice(0, 20)],
  ])("refuses %s", (_what, file) => {
    expect(() => parseEditSourceFile(file())).toThrow(EditSourceError);
  });

  it("undoes the delta coding of the linear16 planes and squares the values", () => {
    const red = [65520, 0, 32768, 4096, 16, 65520];
    const planes = planesOf([red, [0, 0, 0, 0, 0, 0], [256, 512, 768, 1024, 1280, 1536]], 3, 2);
    const pixels = linear16Pixels(planes, 3, 2, 1.4);
    expect(pixels).toHaveLength(18);
    red.forEach((u, i) => expect(defined(pixels[i * 3])).toBeCloseTo(1.4 * (u / 65535) ** 2, 6));
    expect(defined(pixels[5 * 3 + 2])).toBeCloseTo(1.4 * (1536 / 65535) ** 2, 9);
    expect(() => linear16Pixels(planes.subarray(1), 3, 2, 1.4)).toThrow(EditSourceError);
  });

  it("reads a linear16 file: zlib, six planes, delta coded", async () => {
    const values = [
      [65520, 32768, 0, 16, 48000, 8000],
      [100 << 4, 200 << 4, 300 << 4, 400 << 4, 500 << 4, 600 << 4],
      [65520, 65520, 65520, 0, 0, 0],
    ];
    const payload = await deflate(planesOf(values, 2, 3));
    const source = await loadEditSource(lpes(1, header("linear16", 2, 3, 1.4), payload));
    expect(source.kind).toBe("linear16");
    if (source.kind !== "linear16") return;
    expect(source.header.max).toBe(1.4);
    values.forEach((channel, c) =>
      channel.forEach((u, i) => expect(defined(source.pixels[i * 3 + c])).toBeCloseTo(1.4 * (u / 65535) ** 2, 6))
    );
  });

  it("inflates a zlib stream", async () => {
    const text = new TextEncoder().encode("the same bytes again ".repeat(50));
    expect(new TextDecoder().decode(await inflate(await deflate(text)))).toBe("the same bytes again ".repeat(50));
  });
});
