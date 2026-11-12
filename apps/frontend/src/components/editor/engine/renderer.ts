/**
 * The editor's preview: the pipeline of apps/docs/docs/development/photo-editing.md in WebGL2.
 *
 * Passes: geometry (to linear, RGBA16F), noise reduction, planes, develop, finish, present. Each
 * pass's result is kept with the inputs it depends on, so a tone slider reruns only develop,
 * finish and present, and a change of view (zoom, split) only present.
 */
import type { EditSource } from "./editSource";
import { affineToMat3, capSize, fitView, sourceTransform, type Size, type ViewTransform } from "./geometry";
import {
  createProgram,
  createTarget,
  deleteTarget,
  EditorUnsupportedError,
  enableFloatTargets,
  rgbToRgba,
  tableTexture,
  type Program,
  type Target,
} from "./glResources";
import { histogramOf, type Histogram } from "./histogram";
import {
  developUniforms,
  finishUniforms,
  needsFinish,
  needsNoiseReduction,
  needsPlanes,
  planeSize,
  workingSize,
} from "./passes";
import {
  refreshMipmaps,
  runDevelop,
  runFinish,
  runGeometry,
  runNoise,
  runPlane,
  runPresent,
  type PassContext,
} from "./pipeline";
import { beforeRecipe, DEFAULT_RECIPE, type Recipe } from "./recipe";
import { FRAGMENT_SHADERS, VERTEX_SHADER, type PassName } from "./shaders";
import { prepareSource, uploadSource } from "./sourceTexture";
import { curveTable, hueTable, lightTable } from "./tables";

export { EditorUnsupportedError } from "./glResources";

export type ViewMode = "after" | "before" | "split";

export type RenderOptions = Readonly<{
  /** `after` (default), `before` (the recipe's geometry only), or `split`: before left of `split`. */
  mode?: ViewMode;
  /** Where the split view's line is, as a fraction of the canvas width (default 0.5). */
  split?: number;
  /** Where the picture sits on the canvas (default: fitted, centred). */
  view?: ViewTransform;
  /** Ignore the crop but keep orientation, flips and straighten: the crop tool's frame. */
  showFullFrame?: boolean;
}>;

/** What a render drew: the picture's size in working pixels and the view it was drawn with. */
export type RenderInfo = Readonly<{ picture: Size; view: ViewTransform; fullFrame: boolean }>;

export type RendererOptions = Readonly<{
  /** Called when the browser drops the GPU context and when it gives it back (render again then). */
  onContextChange?: (state: "lost" | "restored") => void;
  /** The long edge the passes work at, at most (default: the GPU's texture limit). */
  maxWorkingEdge?: number;
}>;

type Stage = "geometry" | "noise" | "planes" | "develop" | "finish" | "before" | "tables";

/** What the last render drew: its finished picture and what its "before" picture is made from. */
type LastRender = Readonly<{ after: Target; recipe: Recipe; geometryKey: string; sourceMax: number; picture: Size }>;

const HISTOGRAM_EDGE = 256;
const MODES: Readonly<Record<ViewMode, 0 | 1 | 2>> = { after: 0, before: 1, split: 2 };

function openContext(canvas: HTMLCanvasElement | OffscreenCanvas): WebGL2RenderingContext {
  const gl = canvas.getContext("webgl2", { antialias: false, depth: false, stencil: false, premultipliedAlpha: true });
  if (!(gl instanceof WebGL2RenderingContext)) throw new EditorUnsupportedError("webgl2");
  return gl;
}

/** The WebGL2 preview of an edit recipe on a canvas. */
export class EditRenderer {
  private readonly gl: WebGL2RenderingContext;
  private programs: Record<PassName, Program> | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private source: EditSource | null = null;
  /** A scaled-down copy of the caller's image that this renderer made, and closes. */
  private ownedImage: ImageBitmap | null = null;
  private sourceTexture: WebGLTexture | null = null;
  private sourceSize: Size | null = null;
  private readonly targets = new Map<string, Target>();
  private keys: Partial<Record<Stage, string>> = {};
  private tables: { light: WebGLTexture; curve: WebGLTexture; hue: WebGLTexture; empty: WebGLTexture } | null = null;
  private last: LastRender | null = null;
  private lost = false;
  private disposed = false;

  constructor(
    private readonly canvas: HTMLCanvasElement | OffscreenCanvas,
    private readonly options: RendererOptions = {}
  ) {
    this.gl = openContext(canvas);
    this.setUp();
    canvas.addEventListener("webglcontextlost", this.onLost);
    canvas.addEventListener("webglcontextrestored", this.onRestored);
  }

  /** Programs, tables and extensions: once, and again after the context comes back (extensions too). */
  private setUp(): void {
    const { gl } = this;
    if (!enableFloatTargets(gl)) throw new EditorUnsupportedError("float-targets");
    const entries = Object.entries(FRAGMENT_SHADERS).map(
      ([name, fragment]) => [name, createProgram(gl, VERTEX_SHADER, fragment)] as const
    );
    this.programs = {
      geometry: this.pick(entries, "geometry"),
      noise: this.pick(entries, "noise"),
      downsample: this.pick(entries, "downsample"),
      blur: this.pick(entries, "blur"),
      develop: this.pick(entries, "develop"),
      finish: this.pick(entries, "finish"),
      present: this.pick(entries, "present"),
    };
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const empty = tableTexture(gl, null, new Float32Array([0, 0, 0, 1]), 4);
    this.tables = {
      light: tableTexture(gl, null, lightTable(DEFAULT_RECIPE.light), 1),
      curve: gl.createTexture(),
      hue: gl.createTexture(),
      empty,
    };
    // A plane-sized float target proves the float targets work before anything is shown.
    deleteTarget(gl, createTarget(gl, { width: 4, height: 4 }, "half"));
  }

  private pick(entries: readonly (readonly [string, Program])[], name: PassName): Program {
    const entry = entries.find(([key]) => key === name);
    if (entry === undefined) throw new EditorUnsupportedError("shader", name);
    return entry[1];
  }

  private readonly onLost = (event: Event) => {
    event.preventDefault();
    this.lost = true;
    this.forgetResources();
    this.options.onContextChange?.("lost");
  };

  private readonly onRestored = () => {
    try {
      this.setUp();
    } catch (error) {
      // The context came back without what the editor needs: it stays unusable.
      console.error(error);
      return;
    }
    this.lost = false;
    if (this.source) this.sourceTexture = uploadSource(this.gl, this.source, null);
    this.options.onContextChange?.("restored");
  };

  /** Drop every GPU handle (they died with the context, or are being disposed). */
  private forgetResources(): void {
    this.targets.clear();
    this.keys = {};
    this.last = null;
    this.programs = null;
    this.tables = null;
    this.vao = null;
    this.sourceTexture = null;
  }

  /** Whether the browser took the GPU context away; render() draws nothing until it is back. */
  isContextLost(): boolean {
    return this.lost || this.gl.isContextLost();
  }

  /** The long edge a working picture may have. */
  private maxEdge(): number {
    const gl = this.gl;
    const limit = Math.min(
      Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)),
      Number(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE))
    );
    // A lost context answers 0; the size is only a guess until it is back.
    const known = limit > 0 ? limit : 4096;
    return Math.min(known, this.options.maxWorkingEdge ?? known);
  }

  /** Show this source (replacing the last one); it is scaled down if the GPU cannot hold it. */
  async setSource(source: EditSource): Promise<void> {
    const prepared = await prepareSource(source, this.maxEdge());
    const copy = prepared !== source && prepared.kind === "srgb8" ? prepared.image : null;
    if (this.disposed) {
      copy?.close();
      return;
    }
    this.ownedImage?.close();
    this.ownedImage = copy;
    this.source = prepared;
    this.sourceSize = { width: prepared.header.width, height: prepared.header.height };
    this.keys = {};
    this.last = null;
    if (!this.isContextLost()) this.sourceTexture = uploadSource(this.gl, prepared, this.sourceTexture);
  }

  /** The size of the picture render() would draw for a recipe, in working pixels; null without a source. */
  pictureSize(recipe: Recipe, showFullFrame = false): Size | null {
    return this.sourceSize ? workingSize(recipe, this.sourceSize, this.maxEdge(), showFullFrame) : null;
  }

  private context(): PassContext | null {
    if (!this.programs) return null;
    return { gl: this.gl, programs: this.programs, target: (role, size, format) => this.target(role, size, format) };
  }

  private target(role: string, size: Size, format: "half" | "byte"): Target {
    const existing = this.targets.get(role);
    if (existing && existing.width === size.width && existing.height === size.height && existing.format === format) {
      return existing;
    }
    deleteTarget(this.gl, existing);
    const created = createTarget(this.gl, size, format);
    this.targets.set(role, created);
    return created;
  }

  /** Run a stage when its inputs changed since its last run; true when it ran. */
  private stage(stage: Stage, key: string, run: () => void): boolean {
    if (this.keys[stage] === key) return false;
    run();
    this.keys[stage] = key;
    return true;
  }

  private uploadTables(recipe: Recipe): void {
    const tables = this.tables;
    if (!tables) return;
    const key = JSON.stringify([recipe.light, recipe.curve, recipe.mixer, recipe.bw_mix]);
    this.stage("tables", key, () => {
      tableTexture(this.gl, tables.light, lightTable(recipe.light), 1);
      tableTexture(this.gl, tables.curve, rgbToRgba(curveTable(recipe.curve)), 4);
      tableTexture(this.gl, tables.hue, hueTable(recipe.mixer, recipe.bw_mix), 4);
    });
  }

  /** Draw a recipe on the canvas (its drawing buffer size); null while there is nothing to draw with. */
  render(recipe: Recipe, options: RenderOptions = {}): RenderInfo | null {
    const context = this.context();
    const source = this.source;
    const sourceTexture = this.sourceTexture;
    const sourceSize = this.sourceSize;
    const tables = this.tables;
    if (this.isContextLost() || !context || !source || !sourceTexture || !sourceSize || !tables) return null;
    const fullFrame = options.showFullFrame ?? false;
    const mode = options.mode ?? "after";
    const picture = workingSize(recipe, sourceSize, this.maxEdge(), fullFrame);
    const geometryKey = JSON.stringify([recipe.geometry, fullFrame, picture]);
    const geometry = this.target("geometry", picture, "half");
    this.stage("geometry", geometryKey, () => {
      const transform = affineToMat3(sourceTransform(recipe.geometry, sourceSize, fullFrame));
      runGeometry(context, sourceTexture, transform, geometry, fullFrame);
    });

    const noise = needsNoiseReduction(recipe);
    const noiseKey = JSON.stringify([geometryKey, recipe.detail.nr_luminance, recipe.detail.nr_color]);
    const develop = noise ? this.target("noise", picture, "half") : geometry;
    if (noise) {
      this.stage("noise", noiseKey, () =>
        runNoise(context, geometry, develop, {
          luminance: recipe.detail.nr_luminance / 100,
          color: recipe.detail.nr_color / 100,
        })
      );
    }

    const planes = needsPlanes(recipe);
    const planesKey = JSON.stringify([noiseKey, planes]);
    this.stage("planes", planesKey, () => {
      if (!planes) return;
      runPlane(
        context,
        develop,
        "fine",
        planeSize(picture, 1024),
        0.004 * Math.min(1024, Math.max(picture.width, picture.height))
      );
      runPlane(
        context,
        develop,
        "coarse",
        planeSize(picture, 256),
        0.02 * Math.min(256, Math.max(picture.width, picture.height))
      );
    });
    const planeTexture = (role: string) => (planes ? (this.targets.get(role)?.texture ?? tables.empty) : tables.empty);

    this.uploadTables(recipe);
    const sourceMax = source.kind === "linear16" ? source.header.max : 1;
    const finishing = needsFinish(recipe);
    const developKey = JSON.stringify([
      planesKey,
      finishing,
      recipe.wb,
      recipe.light,
      recipe.curve,
      recipe.color,
      recipe.mixer,
      recipe.bw_mix,
      recipe.grading,
      recipe.effects,
    ]);
    const developed = finishing
      ? this.target("developedHalf", picture, "half")
      : this.target("developedByte", picture, "byte");
    const developRan = this.stage("develop", developKey, () => {
      const inputs = {
        coarse: planeTexture("coarse"),
        fine: planeTexture("fine"),
        light: tables.light,
        curve: tables.curve,
        hue: tables.hue,
      };
      runDevelop(context, develop, inputs, developUniforms(recipe, sourceMax), developed);
    });
    let after = developed;
    if (finishing) {
      after = this.target("finished", picture, "byte");
      const finishKey = JSON.stringify([
        developKey,
        recipe.detail.sharpen_amount,
        recipe.detail.sharpen_radius,
        recipe.vignette,
        recipe.grain,
      ]);
      const finished = after;
      this.stage("finish", finishKey, () => {
        runFinish(context, developed, finishUniforms(recipe, picture), finished);
        refreshMipmaps(this.gl, finished);
      });
    } else if (developRan) {
      this.keys.finish = undefined;
      refreshMipmaps(this.gl, developed);
    }

    const last = { after, recipe, geometryKey, sourceMax, picture };
    const before = mode === "after" ? after : this.beforeTarget(context, last);
    const canvas = { width: this.canvas.width, height: this.canvas.height };
    const view = options.view ?? fitView(canvas, picture);
    runPresent(context, after, before, { canvas, picture, view, mode: MODES[mode], split: options.split ?? 0.5 }, null);
    this.last = last;
    return { picture, view, fullFrame };
  }

  /** The "before" picture of a render (its recipe's geometry only), developed when it is not yet. */
  private beforeTarget(context: PassContext, last: LastRender): Target {
    const target = this.target("before", last.picture, "byte");
    const geometry = this.targets.get("geometry");
    const tables = this.tables;
    if (!geometry || !tables) return last.after;
    this.stage("before", JSON.stringify([last.geometryKey, last.sourceMax]), () => {
      const inputs = {
        coarse: tables.empty,
        fine: tables.empty,
        light: tables.light,
        curve: tables.curve,
        hue: tables.hue,
      };
      runDevelop(context, geometry, inputs, developUniforms(beforeRecipe(last.recipe), last.sourceMax), target);
      refreshMipmaps(this.gl, target);
    });
    return target;
  }

  /**
   * The histogram of the last render's finished picture (`after`), or of its "before" picture (the
   * photo with only the recipe's geometry, what Auto reads), from a small readback (at most 256
   * pixels along its long edge). It waits for the GPU: call it throttled, not on every frame.
   */
  histogram(picture: "after" | "before" = "after"): Histogram | null {
    const context = this.context();
    const last = this.last;
    if (this.isContextLost() || !context || !last) return null;
    const shown = picture === "after" ? last.after : this.beforeTarget(context, last);
    const size = capSize(last.picture, HISTOGRAM_EDGE);
    const out = this.target("histogram", size, "byte");
    const present = {
      canvas: size,
      picture: last.picture,
      view: fitView(size, last.picture),
      mode: 0,
      split: 0,
    } as const;
    runPresent(context, shown, shown, present, out);
    const pixels = new Uint8Array(size.width * size.height * 4);
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, out.framebuffer);
    this.gl.readPixels(0, 0, size.width, size.height, this.gl.RGBA, this.gl.UNSIGNED_BYTE, pixels);
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
    return histogramOf(pixels);
  }

  /** Free the GPU resources and stop listening to the canvas; the renderer cannot be used after. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.canvas.removeEventListener("webglcontextlost", this.onLost);
    this.canvas.removeEventListener("webglcontextrestored", this.onRestored);
    const { gl } = this;
    if (!gl.isContextLost()) {
      for (const target of this.targets.values()) deleteTarget(gl, target);
      for (const program of Object.values(this.programs ?? {})) gl.deleteProgram(program.program);
      if (this.tables) for (const texture of Object.values(this.tables)) gl.deleteTexture(texture);
      if (this.sourceTexture) gl.deleteTexture(this.sourceTexture);
      if (this.vao) gl.deleteVertexArray(this.vao);
    }
    this.source = null;
    this.ownedImage?.close();
    this.ownedImage = null;
    this.forgetResources();
  }
}
