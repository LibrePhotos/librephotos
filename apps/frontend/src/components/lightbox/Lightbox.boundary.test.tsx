/**
 * A render error inside the lightbox's viewer shows the lightbox's own
 * fallback (a dialog with Retry and a close button) while the photo grid
 * behind it stays mounted, instead of the route error screen replacing both.
 */
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import i18n from "../../i18n";
import { Lightbox } from "./Lightbox";

const viewer = vi.hoisted(() => ({ throws: true, renders: 0 }));

vi.mock("./ContentViewer", () => ({
  ContentViewer: () => {
    viewer.renders += 1;
    if (viewer.throws) throw new Error("carousel broke");
    return <div data-testid="viewer" />;
  },
}));

vi.mock("../../api_client/photos/hooks", () => ({
  useFetchPhotoDetailsQuery: () => ({ data: undefined }),
}));
// The unsaved-edits guard (#2284) waits on the router for Back; Lightbox.unsavedDrafts.test.tsx covers it.
vi.mock("@tanstack/react-router", () => ({ useBlocker: () => ({ status: "idle" }) }));

let root: Root;
let container: HTMLDivElement;
let consoleError: MockInstance<Console["error"]>;

function buttonNamed(label: string): HTMLButtonElement {
  const found = [...document.body.querySelectorAll("button")].find(b => b.textContent === label);
  if (!found) throw new Error(`no button named "${label}"`);
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
  viewer.throws = true;
  viewer.renders = 0;
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

describe("Lightbox error boundary", () => {
  it("keeps the grid mounted and offers Retry when the viewer throws", async () => {
    const onClose = vi.fn<() => void>();
    await act(async () => {
      root.render(
        <MantineProvider>
          <div data-testid="grid">grid</div>
          <Lightbox
            idx2hash={[{ id: "a", image_hash: "ha" }]}
            selectedImage="a"
            isPublic={false}
            onCloseRequest={onClose}
            onChangedIndex={() => {}}
          />
        </MantineProvider>
      );
    });

    expect(container.querySelector("[data-testid=grid]")).not.toBeNull();
    expect(document.body.querySelector("[role=alert]")?.textContent).toContain(i18n.t("featureboundary.title"));
    expect(consoleError).toHaveBeenCalledWith("[FeatureBoundary:lightbox]", expect.any(Error), expect.any(String));

    viewer.throws = false;
    await act(async () => buttonNamed(i18n.t("featureboundary.retry")).click());

    expect(document.body.querySelector("[data-testid=viewer]")).not.toBeNull();
    expect(document.body.querySelector("[role=alert]")).toBeNull();
    expect(container.querySelector("[data-testid=grid]")).not.toBeNull();
  });
});
