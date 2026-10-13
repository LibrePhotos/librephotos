import { useLayoutEffect, useRef, useState } from "react";
import type { FocusEvent, RefObject } from "react";

/** The rendered row indexes plus a focused row outside them, in order. */
export function withPinnedRow(indexes: number[], pinnedRow: number | null, rowCount: number): number[] {
  if (pinnedRow === null || pinnedRow >= rowCount || indexes.includes(pinnedRow)) return indexes;
  return [...indexes, pinnedRow].sort((a, b) => a - b);
}

/**
 * The first and last rendered row, leaving out a pinned row that is not next to the others: the
 * caller loads data for that range, and a focused row far away would stretch it over every row
 * between the two.
 */
export function sectionBounds(indexes: readonly number[], pinnedRow: number | null): [number, number] {
  const others = pinnedRow === null ? indexes : indexes.filter(index => index !== pinnedRow);
  const first = others[0];
  const last = others.at(-1);
  if (first === undefined || last === undefined) return [indexes[0] ?? -1, indexes.at(-1) ?? -1];
  if (pinnedRow === null || pinnedRow < first - 1 || pinnedRow > last + 1) return [first, last];
  return [Math.min(first, pinnedRow), Math.max(last, pinnedRow)];
}

/** Where focus was: a control (`data-focus-key`) in the column-th cell of a row. */
type FocusSpot = Readonly<{ row: number; column: number; key: string | undefined }>;

/** A lost focus is put back only this long after it was lost, never on a much later render. */
const RESTORE_WINDOW_MS = 5000;

function spotOf(element: Element): FocusSpot | null {
  const rowElement = element.closest<HTMLElement>("[data-virtual-row]");
  const row = rowElement?.dataset.virtualRow;
  if (!rowElement || row === undefined) return null;
  const cell = Array.from(rowElement.children).findIndex(child => child.contains(element));
  const key = element.closest<HTMLElement>("[data-focus-key]")?.dataset.focusKey;
  return { row: Number(row), column: cell, key };
}

function controlAt(grid: HTMLElement | null, { row, column, key }: FocusSpot): HTMLElement | null {
  if (key === undefined) return null;
  const cell = grid?.querySelector(`[data-virtual-row="${row}"]`)?.children[column];
  return cell?.querySelector<HTMLElement>(`[data-focus-key="${key}"]`) ?? null;
}

const focusIsLost = () => document.activeElement === null || document.activeElement === document.body;

/**
 * Keyboard focus in a virtualized grid whose cells hold controls (the faces grid):
 * - the last focused row stays rendered while it scrolls away (it stays pinned while focus is in
 *   a menu's portal, so the menu's trigger is there to take focus back);
 * - when an action replaces a cell's content (a confirmed face leaves, the next one moves in, often
 *   after a placeholder), focus goes to the same control of the new content instead of the page,
 *   so Enter, Enter, Enter reviews face after face.
 */
export function useGridFocus(enabled: boolean, gridRef: RefObject<HTMLElement | null>) {
  const [focusedRow, setFocusedRow] = useState<number | null>(null);
  const focused = useRef<{ element: Element; spot: FocusSpot } | null>(null);
  const lost = useRef<{ spot: FocusSpot; at: number } | null>(null);

  const handleFocus = (event: FocusEvent<HTMLElement>) => {
    const spot = spotOf(event.target);
    lost.current = null;
    if (!spot) return;
    focused.current = { element: event.target, spot };
    setFocusedRow(spot.row);
  };

  // After every render: the cells may have just dropped the focused control, or brought it back
  useLayoutEffect(() => {
    if (!enabled) return;
    const last = focused.current;
    if (last && !last.element.isConnected && focusIsLost()) {
      lost.current = { spot: last.spot, at: performance.now() };
      focused.current = null;
    }
    const pending = lost.current;
    if (!pending) return;
    if (!focusIsLost() || performance.now() - pending.at > RESTORE_WINDOW_MS) {
      lost.current = null;
      return;
    }
    controlAt(gridRef.current, pending.spot)?.focus();
  });

  return { pinnedRow: enabled ? focusedRow : null, handleFocus };
}
