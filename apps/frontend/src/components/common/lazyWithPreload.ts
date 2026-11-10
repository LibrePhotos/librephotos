import type React from "react";
import { createElement, lazy, useState } from "react";

type Loaded<P extends object> = React.ComponentType<P>;

export type LazyWithPreload<P extends object> = Readonly<{
  /** Starts loading the chunk (once); resolves with the component. A failure is not kept. */
  preload: () => Promise<Loaded<P>>;
  /** Loads the chunk ahead of its first use, when that is likely; a failure waits for the use. */
  prefetch: () => void;
  /**
   * The component to render, inside a Suspense and a FeatureBoundary whose `onReset` is `retry`.
   * A mount renders the loaded component once the chunk is in, so a preloaded one shows at once
   * without the Suspense fallback; otherwise the lazy one that loads it. Decided once per mount, so
   * the subtree never switches component type (and remounts) while it is shown.
   */
  Component: (props: P) => React.ReactElement;
  /** After a failed load: the next mount loads the chunk again (the boundary's Retry). */
  retry: () => void;
}>;

/**
 * A component in its own chunk, which `preload`/`prefetch` can fetch before it is first rendered.
 *
 * Unlike a bare `React.lazy`, a failed load (offline, or a stale tab whose chunk a deploy removed) is
 * not cached for good: the FeatureBoundary around the component shows its Retry, which calls `retry`
 * and loads the chunk again. Until then every render reuses the failed lazy component, so React's
 * own re-render after an error does not start a new request each time.
 */
export function lazyWithPreload<P extends object>(load: () => Promise<Loaded<P>>): LazyWithPreload<P> {
  let pending: Promise<Loaded<P>> | undefined;
  let loaded: Loaded<P> | undefined;

  const preload = () => {
    pending ??= load().then(
      component => {
        loaded = component;
        return component;
      },
      (error: unknown) => {
        pending = undefined;
        throw error;
      }
    );
    return pending;
  };

  const prefetch = () => {
    preload().catch(() => undefined);
  };

  let current: Loaded<P> | undefined;
  let failed = false;
  const resolve = (): Loaded<P> => {
    if (loaded) return loaded;
    current ??= lazy(async () => {
      try {
        return { default: await preload() };
      } catch (error) {
        failed = true;
        throw error;
      }
    });
    return current;
  };

  const retry = () => {
    if (!failed) return;
    failed = false;
    current = undefined;
  };

  function Component(props: P) {
    const [Resolved] = useState(resolve);
    return createElement(Resolved, props);
  }

  return { preload, prefetch, Component, retry };
}

/**
 * Runs `task` once the browser is idle (or after `timeoutMs` at the latest), so a prefetch never
 * competes with what the page is drawing. Returns a cancel function for an effect's cleanup.
 */
export function whenIdle(task: () => void, timeoutMs = 2000): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const handle = window.requestIdleCallback(task, { timeout: timeoutMs });
    return () => window.cancelIdleCallback(handle);
  }
  const timer = window.setTimeout(task, Math.min(timeoutMs, 500));
  return () => window.clearTimeout(timer);
}

/**
 * Runs `task` when the browser is idle, but not before `delayMs`: for a prefetch that must not
 * compete with what was just asked for (the photo a lightbox opened on). Returns a cancel function.
 */
export function afterDelayWhenIdle(task: () => void, delayMs: number): () => void {
  let cancelIdle = () => {};
  const timer = window.setTimeout(() => {
    cancelIdle = whenIdle(task);
  }, delayMs);
  return () => {
    window.clearTimeout(timer);
    cancelIdle();
  };
}
