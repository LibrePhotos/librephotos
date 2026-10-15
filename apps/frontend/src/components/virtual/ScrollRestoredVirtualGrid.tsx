import { useElementScrollRestoration } from "@tanstack/react-router";
import React from "react";
import { VirtualGrid } from "./VirtualGrid";
import type { VirtualGridProps } from "./VirtualGrid";

type ScrollRestoredVirtualGridProps = VirtualGridProps & Readonly<{ scrollRestorationId: string }>;

/**
 * A VirtualGrid that comes back where it was (#377). The grid scrolls its own element, not the
 * window, so the router only remembers its position under the element's id; this reads the
 * position saved for the current history entry and starts the grid there, which is how a
 * virtualized list restores (the router's own restore runs before the rows are there).
 */
export function ScrollRestoredVirtualGrid(props: ScrollRestoredVirtualGridProps) {
  const saved = useElementScrollRestoration({ id: props.scrollRestorationId });
  return <VirtualGrid {...props} initialScrollTop={saved?.scrollY} />;
}
