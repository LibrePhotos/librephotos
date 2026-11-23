/**
 * The edit source file ("LPES", apps/docs/docs/development/photo-editing.md, "Edit source file"):
 * the reduced, upright source the preview works on, as the server sends it.
 */

type EditSourceKind = "srgb8" | "linear16";

/** The header of an edit source file. Sizes are upright; `max` is the largest linear value. */
type EditSourceHeader = Readonly<{
  kind: EditSourceKind;
  width: number;
  height: number;
  full_width: number;
  full_height: number;
  max: number;
}>;

/** An edit source file split into its parts; the payload is not decoded yet. */
export type EditSourceFile = Readonly<{ header: EditSourceHeader; payload: Uint8Array<ArrayBuffer> }>;

/** A source ready for the renderer: an image for `srgb8`, linear RGB floats for `linear16`. */
export type EditSource =
  | Readonly<{ kind: "srgb8"; header: EditSourceHeader; image: ImageBitmap }>
  | Readonly<{ kind: "linear16"; header: EditSourceHeader; pixels: Float32Array }>;

/** A file that is not an edit source file the editor can read. */
export class EditSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EditSourceError";
  }
}

const MAGIC = "LPES";
const PREAMBLE = 12;
const KINDS: readonly EditSourceKind[] = ["srgb8", "linear16"];

function isHeader(value: unknown): value is EditSourceHeader {
  if (typeof value !== "object" || value === null) return false;
  const fields = ["width", "height", "full_width", "full_height", "max"] as const;
  return (
    "kind" in value &&
    KINDS.some(kind => kind === value.kind) &&
    fields.every(field => field in value && Number.isFinite(Reflect.get(value, field))) &&
    fields.every(field => Number(Reflect.get(value, field)) > 0)
  );
}

/** Split an edit source file into its header and payload; throws EditSourceError on anything else. */
export function parseEditSourceFile(buffer: ArrayBuffer): EditSourceFile {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < PREAMBLE || new TextDecoder().decode(bytes.subarray(0, 4)) !== MAGIC) {
    throw new EditSourceError("Not an edit source file");
  }
  if (bytes[4] !== 1) throw new EditSourceError(`Unknown edit source format ${String(bytes[4])}`);
  const kind = KINDS[bytes[5] ?? -1];
  if (kind === undefined) throw new EditSourceError(`Unknown edit source kind ${String(bytes[5])}`);
  const headerLength = new DataView(buffer).getUint32(8, true);
  if (PREAMBLE + headerLength > bytes.length) throw new EditSourceError("Truncated edit source header");
  let header: unknown;
  try {
    header = JSON.parse(new TextDecoder().decode(bytes.subarray(PREAMBLE, PREAMBLE + headerLength)));
  } catch {
    throw new EditSourceError("Unreadable edit source header");
  }
  if (!isHeader(header) || header.kind !== kind) throw new EditSourceError("Invalid edit source header");
  if (!Number.isInteger(header.width) || !Number.isInteger(header.height)) {
    throw new EditSourceError("Invalid edit source size");
  }
  return { header, payload: bytes.subarray(PREAMBLE + headerLength) };
}

/** Inflate a zlib stream with the browser's DecompressionStream. */
export async function inflate(compressed: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const input = new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(controller) {
      controller.enqueue(compressed);
      controller.close();
    },
  });
  const reader = input.pipeThrough(new DecompressionStream("deflate")).getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    length += value.length;
  }
  const joined = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }
  return joined;
}

/**
 * The linear RGB values (interleaved, `width * height * 3`) of an inflated `linear16` payload: six
 * planes (red high, red low, green high, ...), each value the difference to its left neighbour
 * modulo 65536, and `value = max * (u / 65535) ** 2`.
 */
export function linear16Pixels(planes: Uint8Array, width: number, height: number, max: number): Float32Array {
  const count = width * height;
  if (planes.length !== count * 6) throw new EditSourceError("The linear16 payload has the wrong size");
  const square = new Float32Array(65536);
  for (let u = 0; u < 65536; u++) square[u] = max * (u / 65535) ** 2;
  const pixels = new Float32Array(count * 3);
  for (let channel = 0; channel < 3; channel++) {
    const high = planes.subarray(channel * 2 * count, (channel * 2 + 1) * count);
    const low = planes.subarray((channel * 2 + 1) * count, (channel * 2 + 2) * count);
    for (let row = 0; row < height; row++) {
      let u = 0;
      for (let column = 0, i = row * width; column < width; column++, i++) {
        u = (u + (((high[i] ?? 0) << 8) | (low[i] ?? 0))) & 0xffff;
        pixels[i * 3 + channel] = square[u] ?? 0;
      }
    }
  }
  return pixels;
}

/** Read an edit source file into a source the renderer takes. */
export async function loadEditSource(buffer: ArrayBuffer): Promise<EditSource> {
  const { header, payload } = parseEditSourceFile(buffer);
  if (header.kind === "linear16") {
    const planes = await inflate(payload);
    return { kind: "linear16", header, pixels: linear16Pixels(planes, header.width, header.height, header.max) };
  }
  const image = await createImageBitmap(new Blob([payload], { type: "image/jpeg" }), {
    premultiplyAlpha: "none",
    colorSpaceConversion: "none",
  });
  if (image.width !== header.width || image.height !== header.height) {
    image.close();
    throw new EditSourceError("The srgb8 payload does not have the header's size");
  }
  return { kind: "srgb8", header, image };
}
