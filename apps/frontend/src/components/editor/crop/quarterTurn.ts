/**
 * The crop tool's Rotate and Flip buttons: a quarter turn or a mirror of the picture as shown,
 * composed into the recipe's geometry so the crop stays on the same part of the picture.
 *
 * The shown picture (before the straighten and the crop) is the source turned by `orientation`
 * and then mirrored by the flips (apps/docs/docs/development/photo-editing.md, stage 1). Turning
 * that clockwise is the next orientation with the two flips swapped (a turned mirror image is the
 * turned image mirrored along the other axis); the crop's centre and size turn with it, and the
 * straighten angle, being relative to the frame, stays. A mirror toggles its flip, mirrors the
 * crop's centre and negates the straighten angle.
 */
import type { EditAspect } from "@librephotos/api-client";
import type { GeometrySettings, Orientation } from "../engine/recipe";

const ORIENTATIONS: readonly Orientation[] = [0, 90, 180, 270];

function turned(orientation: Orientation, quarters: number): Orientation {
  const index = ORIENTATIONS.indexOf(orientation);
  return ORIENTATIONS[(((index + quarters) % 4) + 4) % 4] ?? 0;
}

/** An aspect ratio the other way round ("4:5" for "5:4"); free and "original" stay as they are. */
export function invertAspect(aspect: EditAspect | null): EditAspect | null {
  switch (aspect) {
    case null:
    case "original":
    case "1:1":
      return aspect;
    case "4:5":
      return "5:4";
    case "5:4":
      return "4:5";
    case "5:7":
      return "7:5";
    case "7:5":
      return "5:7";
    case "2:3":
      return "3:2";
    case "3:2":
      return "2:3";
    case "4:3":
      return "3:4";
    case "3:4":
      return "4:3";
    case "16:9":
      return "9:16";
    case "9:16":
      return "16:9";
    case "16:10":
      return "10:16";
    case "10:16":
      return "16:10";
  }
}

/** The geometry of the shown picture turned a quarter clockwise (`right`) or counter-clockwise (`left`). */
export function turnQuarter(geometry: GeometrySettings, direction: "left" | "right"): GeometrySettings {
  const { crop } = geometry;
  const right = direction === "right";
  return {
    ...geometry,
    orientation: turned(geometry.orientation, right ? 1 : -1),
    flip_h: geometry.flip_v,
    flip_v: geometry.flip_h,
    crop:
      crop === null
        ? null
        : {
            cx: right ? 1 - crop.cy : crop.cy,
            cy: right ? crop.cx : 1 - crop.cx,
            w: crop.h,
            h: crop.w,
          },
    aspect: invertAspect(geometry.aspect),
  };
}

/** The geometry of the shown picture mirrored left to right (`horizontal`) or top to bottom. */
export function mirror(geometry: GeometrySettings, axis: "horizontal" | "vertical"): GeometrySettings {
  const { crop } = geometry;
  const horizontal = axis === "horizontal";
  // `-0` would read as a change of the straighten angle in a sparse recipe.
  const straighten = geometry.straighten === 0 ? 0 : -geometry.straighten;
  return {
    ...geometry,
    flip_h: horizontal ? !geometry.flip_h : geometry.flip_h,
    flip_v: horizontal ? geometry.flip_v : !geometry.flip_v,
    straighten,
    crop:
      crop === null
        ? null
        : { ...crop, cx: horizontal ? 1 - crop.cx : crop.cx, cy: horizontal ? crop.cy : 1 - crop.cy },
  };
}
