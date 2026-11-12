/**
 * What the editor needs from outside React: a WebGL renderer for a canvas and the photo's edit
 * source. They come through a context with the real ones as its default, so a test (jsdom has no
 * WebGL) or a harness hands in its own.
 */
import { createContext, useContext } from "react";
import { fetchEditSource } from "../../api_client/editing/photoEdits";
import { loadEditSource, type EditSource } from "./engine/editSource";
import { EditRenderer, type RendererOptions } from "./engine/renderer";

/** The part of EditRenderer the editor uses: the preview, the histogram the advanced mode shows. */
export type PreviewRenderer = Pick<
  EditRenderer,
  "setSource" | "pictureSize" | "render" | "histogram" | "isContextLost" | "dispose"
>;

export type EditorServices = Readonly<{
  /** A renderer on this canvas; throws EditorUnsupportedError where WebGL2 cannot do it. */
  createRenderer: (canvas: HTMLCanvasElement, options: RendererOptions) => PreviewRenderer;
  /** The photo's edit source, decoded. The caller closes an srgb8 source's image when done. */
  loadSource: (photoId: string) => Promise<EditSource>;
  /**
   * Compile the renderer's shaders once, on a canvas of its own, while the source downloads. The
   * browser keeps compiled programs, so the preview's renderer then starts in about 40 ms instead
   * of half a second.
   */
  prepareRenderer: () => void;
}>;

function prepareRenderer(): void {
  if (typeof OffscreenCanvas === "undefined") return;
  try {
    const canvas = new OffscreenCanvas(1, 1);
    new EditRenderer(canvas).dispose();
    canvas.getContext("webgl2")?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    // No WebGL2 here, or not on an OffscreenCanvas: the preview says so, or compiles, when it starts.
  }
}

const BROWSER_SERVICES: EditorServices = {
  createRenderer: (canvas, options) => new EditRenderer(canvas, options),
  loadSource: async photoId => loadEditSource(await fetchEditSource(photoId)),
  prepareRenderer,
};

export const EditorServicesContext = createContext<EditorServices>(BROWSER_SERVICES);

export function useEditorServices(): EditorServices {
  return useContext(EditorServicesContext);
}

/** Free what a source holds outside the garbage collector (an srgb8 source's decoded image). */
export function releaseSource(source: EditSource): void {
  if (source.kind === "srgb8") source.image.close();
}
