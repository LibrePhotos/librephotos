import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { defined } from "../../util/defined.test-utils";
import { useContentBoxSize } from "./useContentBoxSize";

let root: Root;
let container: HTMLDivElement;
let resize: (() => void) | undefined;
let borderBoxWidth = 1200;

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  borderBoxWidth = 1200;
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(() => borderBoxWidth);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(() => 700);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe() {}
      disconnect() {
        resize = undefined;
      }
    }
  );
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
  vi.unstubAllGlobals();
});

const sizes: Array<{ width: number; height: number }> = [];

function Measured({ show = true }: { show?: boolean }) {
  const { ref, width, height } = useContentBoxSize<HTMLDivElement>();
  sizes.push({ width, height });
  return show ? <div ref={ref} style={{ padding: "0px 15px" }} /> : null;
}

describe("useContentBoxSize", () => {
  beforeEach(() => {
    sizes.length = 0;
  });

  it("excludes the element's padding, as the AutoSizer inside it does", async () => {
    await act(async () => {
      root.render(<Measured />);
    });

    expect(sizes.at(-1)).toEqual({ width: 1170, height: 700 });
  });

  it("follows the element as it resizes", async () => {
    await act(async () => {
      root.render(<Measured />);
    });
    borderBoxWidth = 830;
    await act(async () => {
      defined(resize)();
    });

    expect(sizes.at(-1)).toEqual({ width: 800, height: 700 });
  });

  it("measures an element that mounts after the first render", async () => {
    await act(async () => {
      root.render(<Measured show={false} />);
    });
    expect(sizes.at(-1)).toEqual({ width: 0, height: 0 });

    await act(async () => {
      root.render(<Measured />);
    });
    expect(sizes.at(-1)).toEqual({ width: 1170, height: 700 });
  });

  it("stops observing once the element unmounts", async () => {
    await act(async () => {
      root.render(<Measured />);
    });
    await act(async () => {
      root.render(<Measured show={false} />);
    });

    expect(resize).toBeUndefined();
  });
});
