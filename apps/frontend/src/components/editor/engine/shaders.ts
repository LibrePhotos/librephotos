/**
 * The renderer's GLSL (ES 3.00), one fragment shader per pass plus shared chunks, which a pass
 * pulls in with a `//#include <name>` line.
 */
import blurFragment from "./shaders/blur.frag.glsl?raw";
import common from "./shaders/common.glsl?raw";
import developFragment from "./shaders/develop.frag.glsl?raw";
import downsampleFragment from "./shaders/downsample.frag.glsl?raw";
import finishFragment from "./shaders/finish.frag.glsl?raw";
import vertex from "./shaders/fullscreen.vert.glsl?raw";
import geometryFragment from "./shaders/geometry.frag.glsl?raw";
import noiseFragment from "./shaders/noise.frag.glsl?raw";
import oklab from "./shaders/oklab.glsl?raw";
import presentFragment from "./shaders/present.frag.glsl?raw";

const CHUNKS: Readonly<Record<string, string>> = { common, oklab };

/** A shader with its `//#include` lines replaced by their chunks. */
export function assembleShader(source: string, chunks: Readonly<Record<string, string>> = CHUNKS): string {
  return source.replace(/^\/\/#include (\w+)\r?$/gm, (_line: string, name: string) => {
    const chunk = chunks[name];
    if (chunk === undefined) throw new Error(`Unknown shader chunk ${name}`);
    return chunk;
  });
}

/** The vertex shader every pass shares: one triangle over the viewport. */
export const VERTEX_SHADER = vertex;

/** The fragment shader of each pass. */
export const FRAGMENT_SHADERS = {
  geometry: assembleShader(geometryFragment),
  noise: assembleShader(noiseFragment),
  downsample: assembleShader(downsampleFragment),
  blur: assembleShader(blurFragment),
  develop: assembleShader(developFragment),
  finish: assembleShader(finishFragment),
  present: assembleShader(presentFragment),
} as const;

export type PassName = keyof typeof FRAGMENT_SHADERS;
