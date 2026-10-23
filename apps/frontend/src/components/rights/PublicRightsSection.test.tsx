/**
 * The License section of a public photo (#425): the license with its deed, what a visitor may do in
 * words, and the line to credit the photo with; nothing for a photo without rights.
 */
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import i18n from "../../i18n";
import { PublicRightsSection } from "./PublicRightsSection";

let root: Root;
let container: HTMLDivElement;

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
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  await i18n.changeLanguage("en");
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

type Rights = Parameters<typeof PublicRightsSection>[0]["rights"];

async function render(rights: Rights) {
  await act(async () => {
    root.render(
      <MantineProvider env="test">
        <PublicRightsSection rights={rights} />
      </MantineProvider>
    );
  });
  return container.textContent ?? "";
}

describe("PublicRightsSection", () => {
  it("says what a visitor may do with a CC BY-NC photo and how to credit it", async () => {
    const text = await render({ license: "cc-by-nc-4.0", creator: "Anna Berger", copyright: "© 2026 Anna Berger" });

    expect(text).toContain("CC BY-NC 4.0");
    expect(text).toContain("© 2026 Anna Berger");
    expect(text).toContain("Share and adapt it");
    expect(text).toContain("No commercial use");
    expect(text).toContain("Credit the creator and link the license");
    const deed = container.querySelector("a");
    expect(deed?.getAttribute("href")).toBe("https://creativecommons.org/licenses/by-nc/4.0/");
    expect(deed?.getAttribute("rel")).toBe("noopener noreferrer");
    const credit = container.querySelector("textarea")?.value ?? "";
    expect(credit).toContain("Photo by Anna Berger (");
    expect(credit).toContain("licensed under CC BY-NC 4.0 (https://creativecommons.org/licenses/by-nc/4.0/)");
  });

  it("says no changes for a no-derivatives license, and credits a photo without a creator", async () => {
    const text = await render({ license: "cc-by-nd-4.0", creator: null, copyright: null });
    expect(text).toContain("Share it unchanged");
    expect(text).toContain("No changes");
    expect(text).toContain("Commercial use allowed");
    expect(container.querySelector("textarea")?.value).toMatch(/^Photo from /);
  });

  it("asks for no credit for a public-domain photo", async () => {
    await render({ license: "cc0-1.0", creator: "Anna", copyright: null });
    expect(container.querySelector("textarea")).toBeNull();
  });

  it("links no deed for all rights reserved", async () => {
    const text = await render({ license: "all-rights-reserved", creator: null, copyright: "© Studio Nord" });
    expect(text).toContain("No reuse without permission");
    expect(container.querySelector("a")).toBeNull();
  });

  it("shows a copyright without a license, and an unknown license as none", async () => {
    const text = await render({ license: "my-own-license", creator: null, copyright: "© Anna" });
    expect(text).toContain("© Anna");
    expect(container.querySelector(".mantine-Badge-root")).toBeNull();
  });

  it("shows nothing for a photo without rights", async () => {
    await render({ license: null, creator: null, copyright: null });
    expect(container.querySelector("h4")).toBeNull();
    await render(null);
    expect(container.querySelector("h4")).toBeNull();
  });
});
