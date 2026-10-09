/**
 * Unmount every React root a test created once that test is over.
 *
 * Most component tests mount with createRoot() and many never unmount. The
 * roots then outlive their test file: React's scheduler and Mantine's timers
 * (transitions, focus return) fire after vitest has torn the jsdom
 * environment down, and the run fails on "window is not defined" /
 * "document is not defined" even though every test passed. Unmounting inside
 * act() flushes pending work and lets those effects clear their own timers.
 *
 * after* hooks run in reverse order, so a test file's own cleanup runs first;
 * unmounting a root twice is a no-op.
 */
import { act } from "react";
import type { Root } from "react-dom/client";
import { afterEach, vi } from "vitest";

const mountedRoots = new Set<Root>();

vi.mock("react-dom/client", async importOriginal => {
  const actual = await importOriginal<typeof import("react-dom/client")>();
  const createRoot: typeof actual.createRoot = (...args) => {
    const root = actual.createRoot(...args);
    mountedRoots.add(root);
    return root;
  };
  return { ...actual, createRoot };
});

afterEach(() => {
  if (mountedRoots.size === 0) return;
  const globals = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const actEnvironment = globals.IS_REACT_ACT_ENVIRONMENT;
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  try {
    act(() => {
      mountedRoots.forEach(root => root.unmount());
    });
  } finally {
    mountedRoots.clear();
    globals.IS_REACT_ACT_ENVIRONMENT = actEnvironment;
  }
});
