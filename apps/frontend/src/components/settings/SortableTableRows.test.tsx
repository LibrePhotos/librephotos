import { arrayMove } from "@dnd-kit/sortable";
import { MantineProvider, Table } from "@mantine/core";
import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SortableTbody, SortableTr } from "./SortableTableRows";

const ROW_HEIGHT = 40;

let root: Root;
let container: HTMLDivElement;

beforeAll(() => {
  // @ts-ignore - jsdom has no matchMedia, MantineProvider needs it
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
  // @ts-ignore
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  // jsdom has no layout: stack the rows 40px apart so dnd-kit can tell which row is below which.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function rect(this: HTMLElement) {
    const row = this.closest("tr[data-sortable-id]");
    const index = row ? Array.from(row.parentElement!.children).indexOf(row) : 0;
    const top = index * ROW_HEIGHT;
    return {
      x: 0,
      y: top,
      top,
      left: 0,
      width: 400,
      height: ROW_HEIGHT,
      right: 400,
      bottom: top + ROW_HEIGHT,
      toJSON: () => ({}),
    } as DOMRect;
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.restoreAllMocks();
});

function RuleList({ onChange, onDelete }: Readonly<{ onChange: (ids: string[]) => void; onDelete?: () => void }>) {
  const [ids, setIds] = useState(["a", "b", "c", "d"]);
  return (
    <MantineProvider>
      <Table>
        <SortableTbody
          ids={ids}
          onMove={(from, to) => {
            const next = arrayMove(ids, from, to);
            setIds(next);
            onChange(next);
          }}
        >
          {ids.map(id => (
            <SortableTr key={id} id={id}>
              <Table.Td>rule {id}</Table.Td>
              <Table.Td>
                <button type="button" onClick={onDelete}>
                  delete {id}
                </button>
              </Table.Td>
            </SortableTr>
          ))}
        </SortableTbody>
      </Table>
    </MantineProvider>
  );
}

const rowOrder = () =>
  Array.from(container.querySelectorAll("tr[data-sortable-id]"), row => row.getAttribute("data-sortable-id"));
const row = (id: string) => container.querySelector<HTMLElement>(`tr[data-sortable-id="${id}"]`)!;

async function key(target: EventTarget, code: string) {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent("keydown", { code, key: code === "Space" ? " " : code, bubbles: true }));
    // dnd-kit attaches its keyboard listeners and measures the rows a tick after a drag starts
    await new Promise(resolve => setTimeout(resolve, 0));
  });
}

function pointer(type: string, target: EventTarget, clientY: number) {
  // jsdom has no PointerEvent; dnd-kit reads isPrimary, button and the coordinates
  const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: 10, clientY });
  Object.defineProperty(event, "isPrimary", { value: true });
  target.dispatchEvent(event);
}

async function pointerDrag(target: HTMLElement) {
  await act(async () => {
    pointer("pointerdown", target, 10);
  });
  await act(async () => {
    pointer("pointermove", document, 30);
    await new Promise(resolve => setTimeout(resolve, 0));
  });
}

describe("SortableTbody", () => {
  it("makes every row a focusable drag handle", async () => {
    await act(async () => {
      root.render(<RuleList onChange={() => {}} />);
    });

    expect(rowOrder()).toEqual(["a", "b", "c", "d"]);
    expect(row("a").tabIndex).toBe(0);
    expect(row("a").getAttribute("aria-roledescription")).toBe("sortable");
  });

  it("moves a row from the keyboard and saves the order the list shows", async () => {
    const onChange = vi.fn();
    await act(async () => {
      root.render(<RuleList onChange={onChange} />);
    });

    row("a").focus();
    await key(row("a"), "Space");
    await key(document, "ArrowDown");
    await key(document, "ArrowDown");
    await key(document, "Space");

    // A move, not a swap: "a" lands third and "b" and "c" shift up
    expect(onChange).toHaveBeenCalledWith(["b", "c", "a", "d"]);
    expect(rowOrder()).toEqual(["b", "c", "a", "d"]);
  });

  it("leaves the order alone when a keyboard drag is cancelled", async () => {
    const onChange = vi.fn();
    await act(async () => {
      root.render(<RuleList onChange={onChange} />);
    });

    row("b").focus();
    await key(row("b"), "Space");
    await key(document, "ArrowDown");
    await key(document, "Escape");

    expect(onChange).not.toHaveBeenCalled();
    expect(rowOrder()).toEqual(["a", "b", "c", "d"]);
  });

  it("starts a pointer drag from the row after a few pixels of travel", async () => {
    await act(async () => {
      root.render(<RuleList onChange={() => {}} />);
    });

    await pointerDrag(row("a").querySelector("td")!);

    expect(row("a").getAttribute("aria-pressed")).toBe("true");

    // Drop it, and let dnd-kit lift the click guard it holds on the document for 50 ms after a drag
    await act(async () => {
      pointer("pointerup", document, 30);
      await new Promise(resolve => setTimeout(resolve, 60));
    });
  });

  it("does not start a drag from a control inside the row", async () => {
    const onDelete = vi.fn();
    await act(async () => {
      root.render(<RuleList onChange={() => {}} onDelete={onDelete} />);
    });
    const button = row("a").querySelector("button")!;

    await pointerDrag(button);
    await act(async () => {
      button.click();
    });

    expect(row("a").getAttribute("aria-pressed")).toBeNull();
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});
