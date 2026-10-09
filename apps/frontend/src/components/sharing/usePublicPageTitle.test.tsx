/**
 * The reset on leaving a public page ran in a passive effect cleanup, which
 * React runs after the next page's layout effects (where useDocumentTitle sets
 * the title): going straight from one public page to another left the tab
 * reading just "LibrePhotos".
 */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { usePublicPageTitle } from "./usePublicPageTitle";

function AlbumPage() {
  usePublicPageTitle("Holiday");
  return null;
}

function PhotoPage() {
  usePublicPageTitle("Beach");
  return null;
}

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("usePublicPageTitle", () => {
  it("keeps the next public page's title when one page replaces another", async () => {
    await act(async () => root.render(<AlbumPage />));
    expect(document.title).toBe("Holiday · LibrePhotos");

    await act(async () => root.render(<PhotoPage />));
    expect(document.title).toBe("Beach · LibrePhotos");
  });

  it("puts the app name back when the page goes away", async () => {
    await act(async () => root.render(<AlbumPage />));
    await act(async () => root.render(<div />));

    expect(document.title).toBe("LibrePhotos");
  });
});
