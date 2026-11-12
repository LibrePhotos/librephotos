import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PreviewHandle } from "../EditorContext";
import { useEditorServices, type PreviewRenderer } from "../editorServices";
import type { EditSource } from "../engine/editSource";
import type { Size } from "../engine/geometry";
import type { Recipe } from "../engine/recipe";
import { EditorUnsupportedError, type RenderInfo, type ViewMode } from "../engine/renderer";
import { resolveView, type ZoomState } from "./viewMath";

/** What a frame draws. */
export type FrameInput = Readonly<{
  recipe: Recipe;
  mode: ViewMode;
  /** The split view's divider, as a fraction of the canvas width. */
  split: number;
  zoom: ZoomState;
  /** The crop tool's full frame instead of the crop. */
  fullFrame: boolean;
  /** Canvas pixels kept free around a fitted picture (the crop tool's handles). */
  margin: number;
}>;

/** The renderer's state: working, its GPU context gone for now, or no usable WebGL at all. */
export type PreviewStatus = "starting" | "ready" | "lost" | "unsupported" | "failed";

/** What the canvas was last drawn with: the picture's size and where it sits, in canvas pixels. */
export type DrawnFrame = RenderInfo & Readonly<{ canvas: Size; margin: number }>;

function sameFrame(a: DrawnFrame | null, b: DrawnFrame): boolean {
  return (
    a !== null &&
    a.fullFrame === b.fullFrame &&
    a.margin === b.margin &&
    a.picture.width === b.picture.width &&
    a.picture.height === b.picture.height &&
    a.view.scale === b.view.scale &&
    a.view.x === b.view.x &&
    a.view.y === b.view.y &&
    a.canvas.width === b.canvas.width &&
    a.canvas.height === b.canvas.height
  );
}

/**
 * The preview on a canvas: a renderer made for it once the source is in, frames drawn on the next
 * animation frame after a change (never once per input event), the context's loss and return, and
 * everything freed on unmount. `drawn` is the last frame's geometry (for the crop frame and the zoom
 * readout); `firstFrame` turns true once something was drawn.
 */
export function usePreview(canvas: HTMLCanvasElement | null, source: EditSource) {
  const services = useEditorServices();
  const [status, setStatus] = useState<PreviewStatus>("starting");
  const [drawn, setDrawn] = useState<DrawnFrame | null>(null);
  const renderer = useRef<PreviewRenderer | null>(null);
  const input = useRef<FrameInput | null>(null);
  const pending = useRef<number | null>(null);
  const listeners = useRef(new Set<() => void>());

  const draw = useCallback(() => {
    pending.current = null;
    const current = renderer.current;
    const frame = input.current;
    if (!current || !frame || !canvas || canvas.width === 0 || canvas.height === 0) return;
    const size = { width: canvas.width, height: canvas.height };
    const picture = current.pictureSize(frame.recipe, frame.fullFrame);
    if (!picture) return;
    const view = resolveView(frame.zoom, size, picture, frame.margin);
    const info = current.render(frame.recipe, {
      mode: frame.mode,
      split: frame.split,
      view,
      showFullFrame: frame.fullFrame,
    });
    if (!info) return;
    const next = { ...info, canvas: size, margin: frame.margin };
    setDrawn(previous => (sameFrame(previous, next) ? previous : next));
    listeners.current.forEach(listener => listener());
  }, [canvas]);

  /** Draw `frame` on the next animation frame (several requests before it draw once). */
  const request = useCallback(
    (frame?: FrameInput) => {
      if (frame) input.current = frame;
      pending.current ??= requestAnimationFrame(draw);
    },
    [draw]
  );

  useEffect(() => {
    if (!canvas) return;
    let made: PreviewRenderer;
    try {
      made = services.createRenderer(canvas, {
        onContextChange: state => {
          setStatus(state === "lost" ? "lost" : "ready");
          if (state === "restored") request();
        },
      });
    } catch (error) {
      setStatus(error instanceof EditorUnsupportedError ? "unsupported" : "failed");
      if (!(error instanceof EditorUnsupportedError)) console.error(error);
      return;
    }
    let live = true;
    made.setSource(source).then(
      () => {
        if (!live) return;
        renderer.current = made;
        setStatus("ready");
        request();
      },
      (error: unknown) => {
        console.error(error);
        if (live) setStatus("failed");
      }
    );
    return () => {
      live = false;
      if (pending.current !== null) cancelAnimationFrame(pending.current);
      pending.current = null;
      renderer.current = null;
      made.dispose();
    };
  }, [canvas, source, services, request]);

  const handle = useMemo<PreviewHandle>(
    () => ({
      renderer: () => renderer.current,
      onFrame: listener => {
        listeners.current.add(listener);
        return () => {
          listeners.current.delete(listener);
        };
      },
    }),
    []
  );

  return { status, drawn, request, handle };
}
