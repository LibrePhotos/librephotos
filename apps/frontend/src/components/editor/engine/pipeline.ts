/**
 * The passes of the preview, each a draw of one fragment shader into a target. The renderer
 * decides which run (and caches their results); these only draw.
 *
 * A target's picture fills the bottom-left corner of a texture that may be larger (its capacity),
 * so each pass draws the picture's size and reads a target through `cornerTexture`
 * (shaders/common.glsl), which never filters in pixels past the picture.
 */
import type { Size, ViewTransform } from "./geometry";
import type { Program, Target } from "./glResources";
import type { DevelopUniforms, FinishUniforms } from "./passes";

/** The parts of the renderer a pass draws with. */
export type PassContext = Readonly<{
  gl: WebGL2RenderingContext;
  programs: Readonly<Record<"geometry" | "noise" | "downsample" | "blur" | "develop" | "finish" | "present", Program>>;
  /** A target of this role, at this size and format (its texture reused while the size fits). */
  target: (role: string, size: Size, format: "half" | "byte") => Target;
}>;

/** Draw the viewport-covering triangle into a target (or the canvas for null). */
function draw(gl: WebGL2RenderingContext, target: Target | null, size: Size): void {
  gl.bindFramebuffer(gl.FRAMEBUFFER, target?.framebuffer ?? null);
  gl.viewport(0, 0, size.width, size.height);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

const sizeOf = (target: Target): Size => ({ width: target.width, height: target.height });
const sizeVector = (size: Size) => [size.width, size.height];

/** How many pixels past its picture develop and finish fill a byte target with the picture's edge. */
const EDGE_BAND = 256;

/**
 * What develop and finish draw into a target. A byte target's mipmaps, which the present pass
 * minifies with, average whatever lies past the picture into the picture's edge, so those pixels
 * repeat the edge: a band of 256 keeps every level clean up to 128x minification (the fitted view
 * and the histogram readback stay far below it). Not the whole texture: after a crop it can be many
 * times the picture, and filling all of it made every later frame up to 70 % slower. A half target
 * is drawn to its picture only, since its readers clamp to it.
 */
function drawnArea(out: Target): Size {
  if (out.format === "half") return sizeOf(out);
  return {
    width: Math.min(out.capacity.width, out.width + EDGE_BAND),
    height: Math.min(out.capacity.height, out.height + EDGE_BAND),
  };
}

/** Stage 1 into `out`: the source read through the output-to-source matrix, linear. */
export function runGeometry(
  context: PassContext,
  source: WebGLTexture,
  transform: Float32Array,
  out: Target,
  markOutside: boolean
): void {
  context.programs.geometry
    .use()
    .texture("uSource", 0, source)
    .mat3("uTransform", transform)
    .vec("uSize", sizeVector(sizeOf(out)))
    .int("uMarkOutside", markOutside);
  draw(context.gl, out, sizeOf(out));
}

/** Stage 2 from `input` into `out`. */
export function runNoise(
  context: PassContext,
  input: Target,
  out: Target,
  detail: { luminance: number; color: number }
) {
  const u = Math.max(out.width, out.height) / 2560;
  context.programs.noise
    .use()
    .texture("uInput", 0, input.texture)
    .vec("uSize", sizeVector(sizeOf(out)))
    .vec("uInputCapacity", sizeVector(input.capacity))
    .set({ uU: u, uLuminance: detail.luminance, uColor: detail.color });
  draw(context.gl, out, sizeOf(out));
}

/**
 * Stage 3, one plane: D averaged down to `size` (halving passes, then the plane values), then the
 * separable Gaussian of `sigma` plane pixels. The plane ends up in the target of `role`.
 */
export function runPlane(context: PassContext, input: Target, role: string, size: Size, sigma: number): Target {
  const { gl, programs } = context;
  let current = input;
  for (let step = 0; Math.max(current.width, current.height) > 2 * Math.max(size.width, size.height); step++) {
    const half = {
      width: Math.max(1, Math.ceil(current.width / 2)),
      height: Math.max(1, Math.ceil(current.height / 2)),
    };
    const next = context.target(`${role}Chain${step}`, half, "half");
    downsample(programs.downsample, current, half, false);
    draw(gl, next, half);
    current = next;
  }
  const plane = context.target(role, size, "half");
  downsample(programs.downsample, current, size, true);
  draw(gl, plane, size);
  const across = context.target(`${role}Blur`, size, "half");
  programs.blur.use().float("uSigma", sigma).vec("uSize", sizeVector(size));
  programs.blur
    .texture("uInput", 0, plane.texture)
    .vec("uInputCapacity", sizeVector(plane.capacity))
    .vec("uDirection", [1, 0]);
  draw(gl, across, size);
  programs.blur
    .texture("uInput", 0, across.texture)
    .vec("uInputCapacity", sizeVector(across.capacity))
    .vec("uDirection", [0, 1]);
  draw(gl, plane, size);
  return plane;
}

function downsample(program: Program, input: Target, size: Size, values: boolean): void {
  program
    .use()
    .texture("uInput", 0, input.texture)
    .vec("uSize", sizeVector(size))
    .vec("uInputSize", sizeVector(sizeOf(input)))
    .vec("uInputCapacity", sizeVector(input.capacity))
    .int("uValues", values);
}

/** A plane as develop reads it: a target, or a 1x1 stand-in while the planes are off. */
export type PlaneInput = Pick<Target, "texture" | "width" | "height" | "capacity">;

/** The textures the develop pass reads besides D. */
export type DevelopInputs = Readonly<{
  coarse: PlaneInput;
  fine: PlaneInput;
  light: WebGLTexture;
  curve: WebGLTexture;
  hue: WebGLTexture;
}>;

/** Stage 4 from D into `out`. */
export function runDevelop(
  context: PassContext,
  input: Target,
  inputs: DevelopInputs,
  uniforms: DevelopUniforms,
  out: Target
): void {
  const program = context.programs.develop.use();
  program
    .texture("uInput", 0, input.texture)
    .texture("uPlaneCoarse", 1, inputs.coarse.texture)
    .texture("uPlaneFine", 2, inputs.fine.texture)
    .texture("uLightTable", 3, inputs.light)
    .texture("uCurveTable", 4, inputs.curve)
    .texture("uHueTable", 5, inputs.hue)
    .vec("uSize", sizeVector(sizeOf(out)))
    .vec("uCoarseSize", sizeVector(inputs.coarse))
    .vec("uCoarseCapacity", sizeVector(inputs.coarse.capacity))
    .vec("uFineSize", sizeVector(inputs.fine))
    .vec("uFineCapacity", sizeVector(inputs.fine.capacity))
    .vec("uK", uniforms.k)
    .set({
      uGain: uniforms.gain,
      uM: uniforms.M,
      uDehaze: uniforms.dehaze,
      uShadows: uniforms.shadows,
      uHighlights: uniforms.highlights,
      uClarity: uniforms.clarity,
      uTexture: uniforms.texture,
      uVibrance: uniforms.vibrance,
      uSaturation: uniforms.saturation,
      uBalance: uniforms.balance,
      uBlending: uniforms.blending,
    })
    .int("uUseLight", uniforms.useLight)
    .int("uUseCurve", uniforms.useCurve)
    .int("uUseColor", uniforms.useColor)
    .int("uBw", uniforms.bw)
    .vec2Array("uGradeVectors", uniforms.gradeVectors)
    .vec("uGradeLum", uniforms.gradeLum);
  draw(context.gl, out, drawnArea(out));
}

/** Stage 5 from E into `out` (E is a target of the same picture size). */
export function runFinish(context: PassContext, input: Target, uniforms: FinishUniforms, out: Target): void {
  context.programs.finish
    .use()
    .texture("uInput", 0, input.texture)
    .vec("uSize", sizeVector(sizeOf(out)))
    .vec("uInputCapacity", sizeVector(input.capacity))
    .set({
      uSharpen: uniforms.sharpen,
      uSigma: uniforms.sigma,
      uVignette: uniforms.vignette,
      uMidpoint: uniforms.midpoint,
      uFeather: uniforms.feather,
      uRoundness: uniforms.roundness,
      uGrain: uniforms.grain,
      uCells: uniforms.cells,
      uRoughness: uniforms.roughness,
    })
    .uint("uSeed", uniforms.seed);
  draw(context.gl, out, drawnArea(out));
}

/** How the present pass shows the picture. */
export type PresentView = Readonly<{
  canvas: Size;
  picture: Size;
  view: ViewTransform;
  mode: 0 | 1 | 2;
  split: number;
}>;

/**
 * The finished picture (and the before picture) on the canvas, or into the `present.canvas` corner
 * of `out` for a readback.
 */
export function runPresent(
  context: PassContext,
  after: Target,
  before: Target,
  present: PresentView,
  out: Target | null
): void {
  const { gl } = context;
  context.programs.present
    .use()
    .texture("uAfter", 0, after.texture)
    .texture("uBefore", 1, before.texture)
    .vec("uAfterCapacity", sizeVector(after.capacity))
    .vec("uBeforeCapacity", sizeVector(before.capacity))
    .vec("uCanvas", sizeVector(present.canvas))
    .vec("uPicture", sizeVector(present.picture))
    .vec("uView", [present.view.scale, present.view.x, present.view.y])
    .int("uMode", present.mode)
    .float("uSplit", present.split);
  gl.disable(gl.BLEND);
  gl.clearColor(0, 0, 0, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, out?.framebuffer ?? null);
  gl.viewport(0, 0, present.canvas.width, present.canvas.height);
  gl.clear(gl.COLOR_BUFFER_BIT);
  draw(gl, out, present.canvas);
}

/**
 * Refresh a finished picture's mipmaps, which the present pass minifies with. They cover the whole
 * texture, which is why develop and finish fill a band past a byte target's picture (`drawnArea`).
 */
export function refreshMipmaps(gl: WebGL2RenderingContext, target: Target): void {
  gl.bindTexture(gl.TEXTURE_2D, target.texture);
  gl.generateMipmap(gl.TEXTURE_2D);
}
