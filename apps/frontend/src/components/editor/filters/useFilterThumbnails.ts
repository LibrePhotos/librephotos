import { useEffect, useRef, useState } from "react";
import { useEditorServices } from "../editorServices";
import type { EditSource } from "../engine/editSource";
import type { Recipe } from "../engine/recipe";
import { blendFilter, EDIT_FILTERS, ORIGINAL_FILTER } from "./filters";

/** The long edge a look's thumbnail is rendered at. */
const THUMBNAIL_EDGE = 160;

/** A look's thumbnail (a JPEG data URL) by the look's id, `original` for the photo without one. */
export type FilterThumbnails = ReadonlyMap<string, string>;

/**
 * The thumbnails made for a source and a framing (the recipe's geometry), kept while the source
 * lives: the Filters tab unmounts its effects while hidden, and opening it again must not render
 * them again unless the photo was cropped or turned meanwhile.
 */
const made = new WeakMap<EditSource, Map<string, Map<string, string>>>();

function keptFor(source: EditSource, framing: string): Map<string, string> {
  const bySource = made.get(source) ?? new Map<string, Map<string, string>>();
  made.set(source, bySource);
  const kept = bySource.get(framing) ?? new Map<string, string>();
  bySource.set(framing, kept);
  return kept;
}

/** Wait for the next frame, so the main preview and the input keep their turn. */
const nextFrame = () =>
  new Promise<void>(resolve => {
    requestAnimationFrame(() => resolve());
  });

/**
 * Small pictures of this photo with each look, drawn by one low-resolution renderer on a canvas
 * that is never shown, one look per animation frame, once per source and framing. `base` is the
 * photo before any look (its crop included). Nothing is drawn until `enabled` (the main preview's
 * first frame, and the panel showing them is open).
 */
export function useFilterThumbnails(source: EditSource, base: Recipe, enabled: boolean): FilterThumbnails {
  const services = useEditorServices();
  const framing = JSON.stringify(base.geometry);
  const [thumbnails, setThumbnails] = useState<FilterThumbnails>(() => new Map(made.get(source)?.get(framing)));
  // Read when the thumbnails are made: they show the photo as it was then, not again for each edit.
  const baseAtStart = useRef(base);
  useEffect(() => {
    baseAtStart.current = base;
  });

  useEffect(() => {
    const kept = keptFor(source, framing);
    const from = baseAtStart.current;
    const wanted = [
      { id: ORIGINAL_FILTER, recipe: from },
      ...EDIT_FILTERS.map(filter => ({ id: filter.id, recipe: blendFilter(from, filter.values, 1) })),
    ];
    if (!enabled || wanted.every(({ id }) => kept.has(id))) {
      setThumbnails(new Map(kept));
      return;
    }
    let stopped = false;
    const canvas = document.createElement("canvas");
    let renderer: ReturnType<typeof services.createRenderer> | null = null;
    const run = async () => {
      try {
        renderer = services.createRenderer(canvas, { maxWorkingEdge: THUMBNAIL_EDGE });
        await renderer.setSource(source);
        for (const { id, recipe } of wanted) {
          await nextFrame();
          if (stopped) return;
          if (kept.has(id)) continue;
          const size = renderer.pictureSize(recipe);
          if (!size) return;
          canvas.width = size.width;
          canvas.height = size.height;
          if (!renderer.render(recipe)) return;
          // Read in the same task as the draw: the drawing buffer is not kept after it.
          kept.set(id, canvas.toDataURL("image/jpeg", 0.85));
          setThumbnails(new Map(kept));
        }
      } catch (error) {
        // The looks stay usable by name; only their pictures are missing.
        console.warn("Filter thumbnails could not be drawn", error);
      } finally {
        renderer?.dispose();
        renderer = null;
      }
    };
    void run();
    return () => {
      stopped = true;
    };
  }, [source, framing, enabled, services]);

  return thumbnails;
}
