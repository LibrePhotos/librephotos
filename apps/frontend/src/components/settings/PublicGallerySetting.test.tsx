/**
 * The public gallery's admin card (#434): off by default; members only or everyone. Opening it to
 * more people first asks, naming how many photos of how many users go out; closing it does not ask.
 */
import type { GalleryPreview, SiteSettingsUpdate } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { opensWider, previewSentence, PublicGallerySetting } from "./PublicGallerySetting";

const stubs = vi.hoisted(() => ({
  settings: undefined as { public_gallery?: string; public_gallery_indexable?: boolean } | undefined,
  preview: undefined as GalleryPreview | undefined,
  previewAsked: [] as boolean[],
  saved: [] as SiteSettingsUpdate[],
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a href="/public">{children}</a>,
}));
vi.mock("../../api_client/settings/hooks", () => ({ useGetSettingsQuery: () => ({ data: stubs.settings }) }));
vi.mock("../../api_client/gallery/hooks", () => ({
  useGalleryPreviewQuery: (enabled: boolean) => {
    stubs.previewAsked.push(enabled);
    return { data: enabled ? stubs.preview : undefined, isError: false };
  },
}));
vi.mock("./useSaveSiteSettings", () => ({
  useSaveSiteSettings: () => (input: SiteSettingsUpdate) => stubs.saved.push(input),
}));
vi.mock("./SettingsSection", () => ({ SectionLink: () => null }));

const t = i18n.t.bind(i18n);
const photographer = (id: number, name: string, photo_count: number) => ({
  id,
  username: name.toLowerCase(),
  first_name: name,
  last_name: "",
  photo_count,
  cover_photos: [],
});

beforeAll(async () => {
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
  globalThis.ResizeObserver = class {
    observe() {}

    unobserve() {}

    disconnect() {}
  };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
});

let root: Root | undefined;

beforeEach(() => {
  stubs.settings = { public_gallery: "off", public_gallery_indexable: false };
  stubs.preview = { photo_count: 5, photographer_count: 1, photographers: [photographer(2, "Anna", 5)] };
  stubs.previewAsked = [];
  stubs.saved = [];
});

afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.innerHTML = "";
});

async function render() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    defined(root).render(
      <MantineProvider env="test">
        <PublicGallerySetting />
      </MantineProvider>
    )
  );
  return container;
}

function stage(label: string): HTMLInputElement {
  return defined(
    [...document.querySelectorAll<HTMLInputElement>("input[type=radio]")].find(
      input => document.querySelector(`label[for='${input.id}']`)?.textContent === label
    ),
    label
  );
}

describe("opening the public gallery", () => {
  it("asks before it opens to more people, never before it closes", () => {
    expect(opensWider("off", "members")).toBe(true);
    expect(opensWider("members", "everyone")).toBe(true);
    expect(opensWider("everyone", "members")).toBe(false);
    expect(opensWider("members", "off")).toBe(false);
  });

  it("names the photographers with the most photos, and how many more", () => {
    const many = {
      photo_count: 70,
      photographer_count: 7,
      photographers: ["A", "B", "C", "D", "E", "F", "G"].map((name, i) => photographer(i, name, 10)),
    };
    expect(previewSentence(many, false, t)).toBe(
      "It shows 70 photos from 7 photographers: A (10), B (10), C (10), D (10), E (10) and 2 more."
    );
    expect(previewSentence(undefined, false, t)).toBe("Counting the photos...");
    expect(previewSentence(undefined, true, t)).toBe("The photos could not be counted.");
    expect(previewSentence({ photo_count: 0, photographer_count: 0, photographers: [] }, false, t)).toContain(
      "Nobody takes part yet"
    );
  });

  it("confirms with the counts before it opens to everyone", async () => {
    await render();
    await act(async () => stage("Everyone").click());
    expect(stubs.saved).toEqual([]);
    const dialog = defined(document.querySelector("[role=dialog]"));
    expect(dialog.textContent).toContain("Anyone who opens this server's address will see it");
    expect(dialog.textContent).toContain("Anna (5)");
    const button = defined(
      [...dialog.querySelectorAll("button")].find(element => element.textContent === "Open the gallery")
    );
    await act(async () => button.click());
    expect(stubs.saved).toEqual([{ public_gallery: "everyone" }]);
  });

  it("closes without asking, and offers indexing only while it is open", async () => {
    stubs.settings = { public_gallery: "everyone", public_gallery_indexable: false };
    const container = await render();
    const indexing = defined(container.querySelector<HTMLInputElement>("input[type=checkbox]"));
    await act(async () => indexing.click());
    await act(async () => stage("Off").click());
    expect(stubs.saved).toEqual([{ public_gallery_indexable: true }, { public_gallery: "off" }]);
    expect(stubs.previewAsked.every(asked => !asked)).toBe(true);
  });

  it("is not shown by a server without a gallery", async () => {
    stubs.settings = {};
    const container = await render();
    expect(container.querySelector(".mantine-Card-root")).toBeNull();
  });
});
