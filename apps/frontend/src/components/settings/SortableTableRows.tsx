import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type Modifier,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Table, type TableTrProps } from "@mantine/core";
import React from "react";
import type { CSSProperties, PointerEvent, ReactNode } from "react";

const INTERACTIVE = "button, input, textarea, select, option, a[href], label, [contenteditable]";

/**
 * A press on a control inside a row (the enable switch, the delete button) is a click on that
 * control, never the start of a drag - react-beautiful-dnd behaved the same way.
 */
class RowPointerSensor extends PointerSensor {
  static activators = [
    {
      eventName: "onPointerDown" as const,
      handler: ({ nativeEvent: event }: PointerEvent) =>
        event.isPrimary &&
        event.button === 0 &&
        !(event.target instanceof Element && event.target.closest(INTERACTIVE)),
    },
  ];
}

// The rows only reorder, so they only move up and down.
const restrictToVerticalAxis: Modifier = ({ transform }) => ({ ...transform, x: 0 });

type SortableTbodyProps = Readonly<{
  /** The row ids, in their current order. */
  ids: string[];
  /** A row was dropped: move the item at `from` to `to`, shifting the ones between. */
  onMove: (from: number, to: number) => void;
  children: ReactNode;
}>;

/**
 * A table body whose rows (SortableTr) are reordered by dragging them with the mouse or touch,
 * or from the keyboard: focus a row, Space to lift it, the arrow keys to move it, Space to drop
 * it and Escape to cancel.
 */
export function SortableTbody({ ids, onMove, children }: SortableTbodyProps) {
  const sensors = useSensors(
    // A few pixels of travel before a drag starts, so a plain click on a row is still a click.
    useSensor(RowPointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from >= 0 && to >= 0) onMove(from, to);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis]}
      // The screen reader instructions and live region are divs, which may not sit in a <table>.
      accessibility={{ container: document.body }}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <Table.Tbody>{children}</Table.Tbody>
      </SortableContext>
    </DndContext>
  );
}

type SortableTrProps = Readonly<{ id: string; style?: CSSProperties }> & Omit<TableTrProps, "id" | "style">;

/** A row of a SortableTbody. The whole row is the drag handle. */
export function SortableTr({ id, style, children, ...others }: SortableTrProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

  return (
    <Table.Tr
      ref={setNodeRef}
      data-sortable-id={id}
      {...others}
      {...attributes}
      {...listeners}
      style={{
        ...style,
        // Translate, not Transform: a scaled table row squashes its cells.
        transform: CSS.Translate.toString(transform),
        transition,
        cursor: isDragging ? "grabbing" : "grab",
        position: "relative",
        zIndex: isDragging ? 1 : undefined,
        background: isDragging ? "var(--mantine-color-body)" : undefined,
      }}
    >
      {children}
    </Table.Tr>
  );
}
