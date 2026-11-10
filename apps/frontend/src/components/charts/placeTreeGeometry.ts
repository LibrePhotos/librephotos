import { tree } from "d3-hierarchy";
import type { HierarchyNode, HierarchyPointNode } from "d3-hierarchy";
import { pointRadial } from "d3-shape";
import type { TreeLayout, TreeLinkType, TreeOrientation } from "./PlaceTreeControls";

/**
 * The place tree's geometry: where d3's tree layout puts each place, and the path of each link,
 * for the three layouts the toolbar offers (tree left to right, tree top to bottom, radial) and
 * its three connection styles (smooth, step, line). The paths are the ones @visx/shape drew before
 * this replaced it, number for number (placeTreeGeometry.test.ts).
 */

export type PlaceTreeShape = Readonly<{ layout: TreeLayout; orientation: TreeOrientation; linkType: TreeLinkType }>;

/** How far along a link its bend sits: the step's corner, and the strength of a smooth link's curve. */
const BEND = 0.5;

/**
 * Lays the tree out in `size`: [breadth, depth] for a tree, [2π, radius] for a radial one. Siblings
 * sit closer than cousins, and deeper levels closer still.
 */
export function layoutPlaceTree<T>(root: HierarchyNode<T>, size: [number, number]): HierarchyPointNode<T> {
  return tree<T>()
    .size(size)
    .separation((a, b) => (a.parent === b.parent ? 1 : 0.5) / a.depth)(root);
}

type Point = Readonly<{ x: number; y: number }>;

/** Where a laid-out node is drawn: a tree's breadth runs down the page when it grows left to right. */
export function nodePoint(node: Point, { layout, orientation }: Omit<PlaceTreeShape, "linkType">): [number, number] {
  if (layout === "polar") return pointRadial(node.x, node.y);
  return orientation === "vertical" ? [node.x, node.y] : [node.y, node.x];
}

/** A radial point as the links compute it: angle 0 points up. */
function radialPoint(angle: number, radius: number): [number, number] {
  const a = angle - Math.PI / 2;
  return [radius * Math.cos(a), radius * Math.sin(a)];
}

/** A cubic curve from (sx, sy) to (tx, ty), bent to one side by BEND. */
function curve(sx: number, sy: number, tx: number, ty: number): string {
  const dx = tx - sx;
  const dy = ty - sy;
  const ix = BEND * (dx + dy);
  const iy = BEND * (dy - dx);
  return `M${sx},${sy}C${sx + ix},${sy + iy},${tx + iy},${ty - ix},${tx},${ty}`;
}

/** The path of the link from `source` to `target` in the tree's shape. */
export function linkPath(link: Readonly<{ source: Point; target: Point }>, shape: PlaceTreeShape): string {
  const { source, target } = link;
  if (shape.layout === "polar") {
    const [sx, sy] = radialPoint(source.x, source.y);
    const [tx, ty] = radialPoint(target.x, target.y);
    switch (shape.linkType) {
      case "curve":
        return curve(sx, sy, tx, ty);
      case "line":
        return `M${sx},${sy}L${tx},${ty}`;
      case "step": {
        // Along the source's circle to the target's angle, then out to the target.
        const sa = source.x - Math.PI / 2;
        const ta = target.x - Math.PI / 2;
        const sweep = Math.abs(ta - sa) > Math.PI ? ta <= sa : ta > sa;
        const [ax, ay] = radialPoint(target.x, source.y);
        return `M${sx},${sy}A${source.y},${source.y},0,0,${sweep ? 1 : 0},${ax},${ay}L${tx},${ty}`;
      }
    }
  }
  // Left to right, a node's x is its place across the page, so it is drawn as y.
  const [sx, sy, tx, ty] =
    shape.orientation === "vertical"
      ? [source.x, source.y, target.x, target.y]
      : [source.y, source.x, target.y, target.x];
  switch (shape.linkType) {
    case "curve":
      return curve(sx, sy, tx, ty);
    case "line":
      return `M${sx},${sy}L${tx},${ty}`;
    case "step": {
      if (shape.orientation === "vertical") {
        const my = sy + (ty - sy) * BEND;
        return `M${sx},${sy}L${sx},${my}L${tx},${my}L${tx},${ty}`;
      }
      const mx = sx + (tx - sx) * BEND;
      return `M${sx},${sy}L${mx},${sy}L${mx},${ty}L${tx},${ty}`;
    }
  }
}
