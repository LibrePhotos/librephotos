import { EQUIRECTANGULAR_PROJECTION } from "@librephotos/api-client";

/** Whether a photo (its details, or its grid entry) is a 360° photo sphere (#483). */
export function isPhotoSphere(photo: { projection_type?: string | null } | null | undefined): boolean {
  return photo?.projection_type === EQUIRECTANGULAR_PROJECTION;
}

/** The part of a WebGL context the probe uses: it gives the context back at once. */
type ProbedContext = { getExtension(name: "WEBGL_lose_context"): { loseContext(): void } | null };

/**
 * Whether `open` gives a WebGL 2 or WebGL 1 context; the context is released again. A browser
 * that blocks WebGL (a privacy setting, a lost GPU) may also throw.
 */
export function probeWebGL(open: (kind: "webgl2" | "webgl") => ProbedContext | null): boolean {
  try {
    const context = open("webgl2") ?? open("webgl");
    context?.getExtension("WEBGL_lose_context")?.loseContext();
    return context !== null;
  } catch {
    return false;
  }
}

function openCanvasContext(kind: "webgl2" | "webgl"): ProbedContext | null {
  const canvas = document.createElement("canvas");
  return kind === "webgl2" ? canvas.getContext("webgl2") : canvas.getContext("webgl");
}

let webglSupport: boolean | undefined;

/**
 * Whether this browser can draw WebGL, which the 360° viewer needs. Asked once, and only when a
 * sphere is shown: a page without one never creates a context.
 */
export function canShowPhotoSphere(): boolean {
  webglSupport ??= probeWebGL(openCanvasContext);
  return webglSupport;
}
