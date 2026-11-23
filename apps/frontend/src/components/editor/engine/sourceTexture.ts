/** The source as a texture: scaled down when the GPU cannot hold it, then uploaded linear. */
import type { EditSource } from "./editSource";
import { capSize, type Size } from "./geometry";

/**
 * Linear RGB pixels (interleaved) averaged down to `to`: each output pixel is the mean of the source
 * pixels its footprint covers.
 */
export function downscalePixels(pixels: Float32Array, from: Size, to: Size): Float32Array {
  const out = new Float32Array(to.width * to.height * 3);
  for (let y = 0; y < to.height; y++) {
    const y0 = Math.floor((y * from.height) / to.height);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * from.height) / to.height));
    for (let x = 0; x < to.width; x++) {
      const x0 = Math.floor((x * from.width) / to.width);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * from.width) / to.width));
      const sum = [0, 0, 0];
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * from.width + sx) * 3;
          for (let c = 0; c < 3; c++) sum[c] = (sum[c] ?? 0) + (pixels[i + c] ?? 0);
        }
      }
      const count = (y1 - y0) * (x1 - x0);
      for (let c = 0; c < 3; c++) out[(y * to.width + x) * 3 + c] = (sum[c] ?? 0) / count;
    }
  }
  return out;
}

/** The source, scaled down so its long edge is at most `maxEdge`. */
export async function prepareSource(source: EditSource, maxEdge: number): Promise<EditSource> {
  const from = { width: source.header.width, height: source.header.height };
  const to = capSize(from, maxEdge);
  if (to.width === from.width && to.height === from.height) return source;
  const header = { ...source.header, width: to.width, height: to.height };
  if (source.kind === "linear16") return { kind: "linear16", header, pixels: downscalePixels(source.pixels, from, to) };
  const image = await createImageBitmap(source.image, {
    resizeWidth: to.width,
    resizeHeight: to.height,
    resizeQuality: "high",
  });
  return { kind: "srgb8", header, image };
}

/** Upload a source into `texture` (or a new one): sRGB bytes decode to linear when sampled; linear16 is linear. */
export function uploadSource(
  gl: WebGL2RenderingContext,
  source: EditSource,
  texture: WebGLTexture | null
): WebGLTexture {
  const target = texture ?? gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, target);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  const { width, height } = source.header;
  if (source.kind === "srgb8") {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, source.image);
  } else {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB16F, width, height, 0, gl.RGB, gl.FLOAT, source.pixels);
  }
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return target;
}
