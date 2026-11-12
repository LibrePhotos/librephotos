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
}>;

const BROWSER_SERVICES: EditorServices = {
  createRenderer: (canvas, options) => new EditRenderer(canvas, options),
  loadSource: async photoId => loadEditSource(await fetchEditSource(photoId)),
};

export const EditorServicesContext = createContext<EditorServices>(BROWSER_SERVICES);

export function useEditorServices(): EditorServices {
  return useContext(EditorServicesContext);
}

/** Free what a source holds outside the garbage collector (an srgb8 source's decoded image). */
export function releaseSource(source: EditSource): void {
  if (source.kind === "srgb8") source.image.close();
}
