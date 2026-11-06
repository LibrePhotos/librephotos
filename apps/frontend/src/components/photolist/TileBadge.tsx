import React from "react";
import classes from "./TileBadge.module.css";

/** The glyph size inside a tile badge (star, play, stack, archive). */
export const TILE_GLYPH_SIZE = 14;

/**
 * Every mark on a grid tile (favourite, video length, RAW, HDR, stack count): white 12px text and
 * 14px glyphs with a soft shadow and no chip behind them, like Google's, Apple's and Immich's tiles.
 */
export function TileBadge({ className, ...props }: Readonly<React.HTMLAttributes<HTMLSpanElement>>) {
  return <span {...props} className={className ? `${classes.badge} ${className}` : classes.badge} />;
}

/** One corner of a tile: its badges in a row, inset from the tile's edge. */
export function TileCorner({
  position,
  children,
}: Readonly<{ position: "top" | "bottomLeft" | "bottomRight"; children: React.ReactNode }>) {
  return <div className={`${classes.corner} ${classes[position]}`}>{children}</div>;
}
