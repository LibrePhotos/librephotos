import { Box } from "@mantine/core";
import React, { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { DrawnFrame } from "../canvas/usePreview";
import { useEditor } from "../EditorContext";
import { fullFrameLayout, orientedSize, type PixelCrop, type Point } from "../engine/geometry";
import type { Recipe } from "../engine/recipe";
import { aspectRatio, CROP_HANDLES, dragCrop, nudgeDelta, settleCrop, type CropHandle } from "./cropDrag";
import classes from "./CropOverlay.module.css";

type Props = Readonly<{
  /** The full frame as drawn: the picture's working size and where it sits on the canvas. */
  frame: DrawnFrame;
  /** Canvas pixels per CSS pixel. */
  pixelRatio: number;
}>;

type Drag = Readonly<{ handle: CropHandle; pointer: Point; crop: PixelCrop; recipe: Recipe }>;

/**
 * The crop frame over the full frame: the outside dimmed, rule-of-thirds lines, corner and edge
 * handles (mouse, pen and touch), and the arrow keys to move it (Shift: ten times as far). A drag or
 * a held key is live while it lasts and one crop step when it ends.
 */
export function CropOverlay({ frame, pixelRatio }: Props) {
  const { t } = useTranslation();
  const { session, commands, sourceSize } = useEditor();
  const geometry = session.recipe.geometry;
  const layout = fullFrameLayout(geometry, sourceSize);
  // Full-frame source pixels to CSS pixels: the working picture's scale, the view's, the screen's.
  const scale = ((frame.picture.width / layout.size.width) * frame.view.scale) / pixelRatio;
  const origin = { x: frame.view.x / pixelRatio, y: frame.view.y / pixelRatio };
  const crop = layout.crop;
  const oriented = orientedSize(sourceSize, geometry.orientation);
  const ratio = aspectRatio(geometry.aspect, oriented);
  const minSize = Math.max(1, 0.02 * Math.max(oriented.width, oriented.height));

  const drag = useRef<Drag | null>(null);
  const moved = useRef<Recipe | null>(null);
  // Undo (Ctrl+Z) during a drag drops its live crop: the drag ends there, and letting go adds nothing.
  const live = session.live;
  useEffect(() => {
    if (live !== null) return;
    drag.current = null;
    moved.current = null;
  }, [live]);

  const show = (start: Drag, delta: Point) => {
    const drawn = dragCrop(start.crop, start.handle, delta, ratio, minSize);
    const next = {
      ...start.recipe,
      geometry: { ...start.recipe.geometry, crop: settleCrop(drawn, start.recipe.geometry, sourceSize) },
    };
    moved.current = next;
    commands.liveRecipe("geometry.crop", next);
  };
  const finish = () => {
    drag.current = null;
    const next = moved.current;
    moved.current = null;
    if (next) commands.apply("crop", next);
  };

  const start = (handle: CropHandle) => (event: React.PointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { handle, pointer: { x: event.clientX, y: event.clientY }, crop, recipe: session.recipe };
  };
  const move = (event: React.PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current) return;
    event.stopPropagation();
    show(current, { x: (event.clientX - current.pointer.x) / scale, y: (event.clientY - current.pointer.y) / scale });
  };
  const pointerHandlers = (handle: CropHandle) => ({
    onPointerDown: start(handle),
    onPointerMove: move,
    onPointerUp: finish,
    onPointerCancel: finish,
  });

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const delta = nudgeDelta(event.key, event.shiftKey, layout.size);
    if (!delta) return;
    event.preventDefault();
    const base = moved.current ?? session.recipe;
    const from = fullFrameLayout(base.geometry, sourceSize).crop;
    show({ handle: "move", pointer: { x: 0, y: 0 }, crop: from, recipe: base }, delta);
  };

  return (
    <div className={classes.overlay}>
      <Box
        className={classes.frame}
        left={origin.x + (crop.x - crop.width / 2) * scale}
        top={origin.y + (crop.y - crop.height / 2) * scale}
        w={crop.width * scale}
        h={crop.height * scale}
        tabIndex={0}
        role="group"
        aria-roledescription={t("editor.crop.frameRole")}
        aria-label={t("editor.crop.frame")}
        onKeyDown={onKeyDown}
        onKeyUp={finish}
        onBlur={finish}
        {...pointerHandlers("move")}
      >
        <div className={classes.columns} />
        <div className={classes.rows} />
        {CROP_HANDLES.map(handle => (
          <div key={handle} className={classes.handle} data-handle={handle} {...pointerHandlers(handle)} />
        ))}
      </Box>
    </div>
  );
}
