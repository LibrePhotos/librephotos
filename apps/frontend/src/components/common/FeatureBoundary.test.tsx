/**
 * A render error in one feature shows a small inline fallback with Retry
 * instead of the route error screen, is logged, and clears on Retry or when
 * one of the boundary's resetKeys changes.
 */
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import i18n from "../../i18n";
import { FeatureBoundary } from "./FeatureBoundary";

const state = { throws: true };

function Fragile() {
  if (state.throws) throw new Error("renderer broke");
  return <p data-testid="feature">feature</p>;
}

let root: Root;
let container: HTMLDivElement;
let consoleError: MockInstance<Console["error"]>;

const render = async (element: React.ReactNode) => {
  await act(async () => {
    root.render(<MantineProvider>{element}</MantineProvider>);
  });
};

function retryButton(): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find(b => b.textContent === i18n.t("featureboundary.retry"));
  if (!found) throw new Error("no Retry button");
  return found;
}

beforeAll(async () => {
  // jsdom has no matchMedia, MantineProvider needs it
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
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  state.throws = true;
  // React reports the caught error too; keep the output clean and assert on our own log.
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  consoleError.mockRestore();
});

describe("FeatureBoundary", () => {
  it("shows the inline fallback for a throwing child and keeps its siblings", async () => {
    await render(
      <>
        <p data-testid="sibling">grid</p>
        <FeatureBoundary name="test">
          <Fragile />
        </FeatureBoundary>
      </>
    );

    expect(container.querySelector("[data-testid=sibling]")).not.toBeNull();
    expect(container.querySelector("[data-testid=feature]")).toBeNull();
    expect(container.querySelector("[role=alert]")?.textContent).toContain(i18n.t("featureboundary.title"));
    expect(consoleError).toHaveBeenCalledWith("[FeatureBoundary:test]", expect.any(Error), expect.any(String));
  });

  it("renders the child again on Retry", async () => {
    await render(
      <FeatureBoundary name="test">
        <Fragile />
      </FeatureBoundary>
    );
    state.throws = false;

    await act(async () => retryButton().click());

    expect(container.querySelector("[data-testid=feature]")).not.toBeNull();
    expect(container.querySelector("[role=alert]")).toBeNull();
  });

  it("resets when a reset key changes", async () => {
    await render(
      <FeatureBoundary name="test" resetKeys={["/a"]}>
        <Fragile />
      </FeatureBoundary>
    );
    state.throws = false;

    // Same keys: the fallback stays.
    await render(
      <FeatureBoundary name="test" resetKeys={["/a"]}>
        <Fragile />
      </FeatureBoundary>
    );
    expect(container.querySelector("[role=alert]")).not.toBeNull();

    await render(
      <FeatureBoundary name="test" resetKeys={["/b"]}>
        <Fragile />
      </FeatureBoundary>
    );
    expect(container.querySelector("[data-testid=feature]")).not.toBeNull();
  });

  it("hands a custom fallback the reset", async () => {
    await render(
      <FeatureBoundary
        name="test"
        fallback={({ reset }) => (
          <button type="button" onClick={reset}>
            again
          </button>
        )}
      >
        <Fragile />
      </FeatureBoundary>
    );
    state.throws = false;

    await act(async () => container.querySelector("button")?.click());

    expect(container.querySelector("[data-testid=feature]")).not.toBeNull();
  });
});
