/**
 * The chunks the lightbox, its map and its caption editor load on demand: a prefetched one renders
 * at once, and a failed load is retried by the boundary's Retry instead of staying broken.
 */
import { MantineProvider } from "@mantine/core";
import React, { act, Suspense } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { FeatureBoundary } from "./FeatureBoundary";
import { afterDelayWhenIdle, lazyWithPreload, whenIdle } from "./lazyWithPreload";

function Greeting({ name }: Readonly<{ name: string }>) {
  return <p>Hello {name}</p>;
}

let root: Root | undefined;
let container: HTMLDivElement | undefined;

beforeAll(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
  await i18n.changeLanguage("en");
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function mount(chunk: ReturnType<typeof lazyWithPreload<{ name: string }>>) {
  function Slot() {
    return (
      <FeatureBoundary name="test" onReset={chunk.retry}>
        <Suspense fallback={<p>loading</p>}>
          <chunk.Component name="Ada" />
        </Suspense>
      </FeatureBoundary>
    );
  }
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    defined(root).render(
      <MantineProvider>
        <Slot />
      </MantineProvider>
    )
  );
  return defined(container);
}

describe("lazyWithPreload", () => {
  it("renders a prefetched component at once, without its fallback", async () => {
    const load = vi.fn(async () => Greeting);
    const chunk = lazyWithPreload(load);
    await chunk.preload();

    expect(mount(chunk).querySelector("p")?.textContent).toBe("Hello Ada");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("shows the fallback until a chunk that was not prefetched arrives", async () => {
    const chunk = lazyWithPreload(async () => Greeting);
    const shown = mount(chunk);
    expect(shown.querySelector("p")?.textContent).toBe("loading");

    await act(async () => {
      await chunk.preload();
    });
    expect(shown.querySelector("p")?.textContent).toBe("Hello Ada");
  });

  it("loads the chunk once, however often it is asked for", async () => {
    const load = vi.fn(async () => Greeting);
    const chunk = lazyWithPreload(load);
    chunk.prefetch();
    chunk.prefetch();
    await chunk.preload();

    expect(load).toHaveBeenCalledTimes(1);
  });

  // Offline (or a tab older than the last deploy): every load fails until the chunk is reachable.
  // React may render again after the error itself, which loads again too.
  it("keeps a failed load inside the boundary, and loads again on Retry", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let reachable = false;
    const load = vi.fn(async () => {
      if (!reachable) throw new TypeError("Failed to fetch dynamically imported module");
      return Greeting;
    });
    const chunk = lazyWithPreload(load);
    const shown = mount(chunk);
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(shown.querySelector('[role="alert"]')).not.toBeNull();
    // Not a request per re-render: the failed load is reused until Retry.
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 20));
    });
    const attempts = load.mock.calls.length;
    expect(attempts).toBe(1);

    reachable = true;
    const retry = defined([...shown.querySelectorAll("button")].find(button => button.textContent === "Retry"));
    await act(async () => retry.click());
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(shown.querySelector("p")?.textContent).toBe("Hello Ada");
    expect(load.mock.calls.length).toBeGreaterThan(attempts);
  });

  it("does not report a failed prefetch: the use that follows tries again", async () => {
    const load = vi.fn<() => Promise<typeof Greeting>>().mockRejectedValueOnce(new Error("offline"));
    load.mockResolvedValue(Greeting);
    const chunk = lazyWithPreload(load);
    const unhandled = vi.fn<() => void>();
    window.addEventListener("unhandledrejection", unhandled);

    chunk.prefetch();
    await new Promise(resolve => setTimeout(resolve, 0));
    await expect(chunk.preload()).resolves.toBe(Greeting);

    window.removeEventListener("unhandledrejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });
});

describe("whenIdle", () => {
  it("runs the task when the browser is idle, and not once cancelled", () => {
    const callbacks: IdleRequestCallback[] = [];
    vi.stubGlobal("requestIdleCallback", (callback: IdleRequestCallback) => callbacks.push(callback));
    vi.stubGlobal("cancelIdleCallback", (handle: number) => callbacks.splice(handle - 1, 1));
    const task = vi.fn<() => void>();

    const cancel = whenIdle(task);
    expect(task).not.toHaveBeenCalled();
    cancel();
    expect(callbacks).toEqual([]);

    whenIdle(task);
    defined(callbacks[0])({ didTimeout: false, timeRemaining: () => 10 });
    expect(task).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("falls back to a timer without requestIdleCallback", () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestIdleCallback", undefined);
    const task = vi.fn<() => void>();

    whenIdle(task);
    vi.advanceTimersByTime(499);
    expect(task).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(task).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("waits the delay first, then for the browser to be idle", () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestIdleCallback", undefined);
    const task = vi.fn<() => void>();

    const cancel = afterDelayWhenIdle(task, 1500);
    vi.advanceTimersByTime(1500 + 499);
    expect(task).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(task).toHaveBeenCalledTimes(1);

    afterDelayWhenIdle(task, 1500)();
    vi.advanceTimersByTime(5000);
    expect(task).toHaveBeenCalledTimes(1);
    cancel();
    vi.unstubAllGlobals();
  });
});
