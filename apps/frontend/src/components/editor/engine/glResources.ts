/**
 * Thin WebGL2 helpers for the renderer: programs with cached uniform locations, render targets and
 * table textures.
 */
import type { Size } from "./geometry";

/** WebGL2 cannot do what the editor needs on this device. */
export class EditorUnsupportedError extends Error {
  readonly reason: "webgl2" | "float-targets" | "shader";

  constructor(reason: EditorUnsupportedError["reason"], detail = "") {
    super(`The photo editor is not supported here (${reason})${detail ? `: ${detail}` : ""}`);
    this.name = "EditorUnsupportedError";
    this.reason = reason;
  }
}

type UniformValue = number | boolean | Float32Array | readonly number[];

/** A linked program and the setters of its uniforms. */
export class Program {
  private readonly locations = new Map<string, WebGLUniformLocation | null>();

  constructor(
    private readonly gl: WebGL2RenderingContext,
    readonly program: WebGLProgram
  ) {}

  private location(name: string): WebGLUniformLocation | null {
    if (!this.locations.has(name)) this.locations.set(name, this.gl.getUniformLocation(this.program, name));
    return this.locations.get(name) ?? null;
  }

  use(): this {
    this.gl.useProgram(this.program);
    return this;
  }

  float(name: string, value: number | boolean): this {
    this.gl.uniform1f(this.location(name), Number(value));
    return this;
  }

  int(name: string, value: number | boolean): this {
    this.gl.uniform1i(this.location(name), Number(value));
    return this;
  }

  uint(name: string, value: number): this {
    this.gl.uniform1ui(this.location(name), value >>> 0);
    return this;
  }

  vec(name: string, value: Float32Array | readonly number[]): this {
    const data = value instanceof Float32Array ? value : new Float32Array(value);
    const location = this.location(name);
    if (data.length === 2) this.gl.uniform2fv(location, data);
    else if (data.length === 3) this.gl.uniform3fv(location, data);
    else this.gl.uniform4fv(location, data);
    return this;
  }

  /** An array of vec2 (`uniform vec2 name[n]`). */
  vec2Array(name: string, value: Float32Array): this {
    this.gl.uniform2fv(this.location(`${name}[0]`), value);
    return this;
  }

  mat3(name: string, value: Float32Array): this {
    this.gl.uniformMatrix3fv(this.location(name), false, value);
    return this;
  }

  /** Bind a texture to a unit and point a sampler at it. */
  texture(name: string, unit: number, texture: WebGLTexture): this {
    this.gl.activeTexture(this.gl.TEXTURE0 + unit);
    this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
    this.gl.uniform1i(this.location(name), unit);
    return this;
  }

  set(values: Readonly<Record<string, UniformValue>>): this {
    for (const [name, value] of Object.entries(values)) {
      if (typeof value === "number" || typeof value === "boolean") this.float(name, value);
      else this.vec(name, value);
    }
    return this;
  }
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (shader === null) throw new EditorUnsupportedError("shader", "createShader failed");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) !== true && !gl.isContextLost()) {
    const log = gl.getShaderInfoLog(shader) ?? "";
    gl.deleteShader(shader);
    throw new EditorUnsupportedError("shader", log);
  }
  return shader;
}

/** Compile and link a program; throws EditorUnsupportedError("shader") with the driver's log. */
export function createProgram(gl: WebGL2RenderingContext, vertex: string, fragment: string): Program {
  const program = gl.createProgram();
  const vs = compile(gl, gl.VERTEX_SHADER, vertex);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragment);
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true && !gl.isContextLost()) {
    throw new EditorUnsupportedError("shader", gl.getProgramInfoLog(program) ?? "");
  }
  return new Program(gl, program);
}

/** A texture the passes render into, with its framebuffer. */
export type Target = Readonly<{
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
  width: number;
  height: number;
  format: TargetFormat;
}>;

/** `half`: RGBA16F, linear values above 1 kept. `byte`: RGBA8 with mipmaps, the finished picture. */
export type TargetFormat = "half" | "byte";

function setSampling(gl: WebGL2RenderingContext, minFilter: number) {
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, minFilter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

export function createTarget(gl: WebGL2RenderingContext, size: Size, format: TargetFormat): Target {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  if (format === "half") {
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA16F, size.width, size.height);
    setSampling(gl, gl.LINEAR);
  } else {
    const levels = Math.floor(Math.log2(Math.max(size.width, size.height))) + 1;
    gl.texStorage2D(gl.TEXTURE_2D, levels, gl.RGBA8, size.width, size.height);
    setSampling(gl, gl.LINEAR_MIPMAP_LINEAR);
  }
  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (status !== gl.FRAMEBUFFER_COMPLETE && !gl.isContextLost()) {
    gl.deleteFramebuffer(framebuffer);
    gl.deleteTexture(texture);
    throw new EditorUnsupportedError("float-targets", `framebuffer status ${status}`);
  }
  return { texture, framebuffer, width: size.width, height: size.height, format };
}

export function deleteTarget(gl: WebGL2RenderingContext, target: Target | null | undefined): void {
  if (!target) return;
  gl.deleteFramebuffer(target.framebuffer);
  gl.deleteTexture(target.texture);
}

/** A one-row float texture (R32F or RGBA32F) for a table read with texelFetch. */
export function tableTexture(
  gl: WebGL2RenderingContext,
  texture: WebGLTexture | null,
  data: Float32Array,
  channels: 1 | 4
): WebGLTexture {
  const target = texture ?? gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, target);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  const width = data.length / channels;
  const [internal, format] = channels === 1 ? [gl.R32F, gl.RED] : [gl.RGBA32F, gl.RGBA];
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, width, 1, 0, format, gl.FLOAT, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return target;
}

/** RGB triples packed as RGBA, for a texture that wants four channels. */
export function rgbToRgba(rgb: Float32Array): Float32Array {
  const count = rgb.length / 3;
  const rgba = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    rgba[i * 4] = rgb[i * 3] ?? 0;
    rgba[i * 4 + 1] = rgb[i * 3 + 1] ?? 0;
    rgba[i * 4 + 2] = rgb[i * 3 + 2] ?? 0;
    rgba[i * 4 + 3] = 1;
  }
  return rgba;
}

/** Whether this WebGL2 context can render into RGBA16F (EXT_color_buffer_float, or the half-float one). */
export function enableFloatTargets(gl: WebGL2RenderingContext): boolean {
  return gl.getExtension("EXT_color_buffer_float") !== null || gl.getExtension("EXT_color_buffer_half_float") !== null;
}
