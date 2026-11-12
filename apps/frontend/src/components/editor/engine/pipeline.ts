/**
 * The passes of the preview, each a draw of one fragment shader into a target. The renderer
 * decides which run (and caches their results); these only draw.
 */
import type { Size, ViewTransform } from "./geometry";
import type { Program, Target } from "./glResources";
import type { DevelopUniforms, FinishUniforms } from "./passes";

/** The parts of the renderer a pass draws with. */
export type PassContext = Readonly<{
  gl: WebGL2RenderingContext;
  programs: Readonly<Record<"geometry" | "noise" | "downsample" | "blur" | "develop" | "finish" | "present", Program>>;
  /** A target of this role, at this size and format (reused while they match). */
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
    programs.downsample
      .use()
      .texture("uInput", 0, current.texture)
      .vec("uSize", sizeVector(half))
      .vec("uInputSize", sizeVector(sizeOf(current)))
      .int("uValues", false);
    draw(gl, next, half);
    current = next;
  }
  const plane = context.target(role, size, "half");
  programs.downsample
    .use()
    .texture("uInput", 0, current.texture)
    .vec("uSize", sizeVector(size))
    .vec("uInputSize", sizeVector(sizeOf(current)))
    .int("uValues", true);
  draw(gl, plane, size);
  const across = context.target(`${role}Blur`, size, "half");
  programs.blur.use().float("uSigma", sigma).vec("uSize", sizeVector(size));
  programs.blur.texture("uInput", 0, plane.texture).vec("uDirection", [1, 0]);
  draw(gl, across, size);
  programs.blur.texture("uInput", 0, across.texture).vec("uDirection", [0, 1]);
  draw(gl, plane, size);
  return plane;
}

/** The textures the develop pass reads besides D. */
export type DevelopInputs = Readonly<{
  coarse: WebGLTexture;
  fine: WebGLTexture;
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
    .texture("uPlaneCoarse", 1, inputs.coarse)
    .texture("uPlaneFine", 2, inputs.fine)
    .texture("uLightTable", 3, inputs.light)
    .texture("uCurveTable", 4, inputs.curve)
    .texture("uHueTable", 5, inputs.hue)
    .vec("uSize", sizeVector(sizeOf(out)))
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
  draw(context.gl, out, sizeOf(out));
}

/** Stage 5 from E into `out`. */
export function runFinish(context: PassContext, input: Target, uniforms: FinishUniforms, out: Target): void {
  context.programs.finish
    .use()
    .texture("uInput", 0, input.texture)
    .vec("uSize", sizeVector(sizeOf(out)))
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
  draw(context.gl, out, sizeOf(out));
}

/** How the present pass shows the picture. */
export type PresentView = Readonly<{
  canvas: Size;
  picture: Size;
  view: ViewTransform;
  mode: 0 | 1 | 2;
  split: number;
}>;

/** The finished picture (and the before picture) on the canvas, or into `out` for a readback. */
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

/** Refresh a finished picture's mipmaps, which the present pass minifies with. */
export function refreshMipmaps(gl: WebGL2RenderingContext, target: Target): void {
  gl.bindTexture(gl.TEXTURE_2D, target.texture);
  gl.generateMipmap(gl.TEXTURE_2D);
}
