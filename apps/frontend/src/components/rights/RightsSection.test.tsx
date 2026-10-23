/**
 * The owner's Rights section (#425): the license as a badge with a link to its deed (never a URL the
 * file gave), which values are the file's, the owner's default for a photo without rights, and an
 * edit that sends only the fields that changed.
 */
import type { PhotoMetadata, PhotoMetadataUpdate } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SetPhotosRightsRequest } from "../../api_client/photos/hooks";
import i18n from "../../i18n";
import { RightsSection } from "./RightsSection";

const mocks = vi.hoisted(() => ({
  metadata: undefined as Partial<PhotoMetadata> | undefined,
  user: undefined as { default_license?: string; default_creator?: string; default_copyright?: string } | undefined,
  update:
    vi.fn<(args: { photoId: string; updates: PhotoMetadataUpdate }, options?: { onSuccess?: () => void }) => void>(),
  setRights: vi.fn<(args: SetPhotosRightsRequest) => void>(),
}));

vi.mock("../../api_client/photos/hooks", () => ({
  useFetchPhotoMetadataQuery: () => ({ data: mocks.metadata }),
  useUpdatePhotoMetadataMutation: () => ({ mutate: mocks.update, isPending: false }),
  useSetPhotosRightsMutation: () => ({ mutate: mocks.setRights, isPending: false }),
}));
vi.mock("../../api_client/user/hooks/useCurrentUserSelfDetailsQuery", () => ({
  useCurrentUserSelfDetailsQuery: () => ({ data: mocks.user }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a>,
}));

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
  // The license picker's dropdown measures itself; jsdom has no ResizeObserver.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  mocks.update.mockReset();
  mocks.setRights.mockReset();
  mocks.user = { default_license: "", default_creator: "", default_copyright: "" };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render(metadata: Partial<PhotoMetadata>) {
  mocks.metadata = { copyright: null, creator: null, license: null, rights_from_file: [], ...metadata };
  await act(async () => {
    root.render(
      <MantineProvider env="test">
        <RightsSection photo={{ id: "p1", image_hash: "h1" }} />
      </MantineProvider>
    );
  });
}

const button = (name: string) => {
  const found = Array.from(container.querySelectorAll("button")).find(
    element => element.getAttribute("aria-label") === name || element.textContent === name
  );
  if (!found) throw new Error(`no button ${name}`);
  return found;
};

async function click(element: HTMLElement) {
  await act(async () => element.click());
}

async function type(label: string, value: string) {
  const input = Array.from(container.querySelectorAll("input")).find(element =>
    element.closest(".mantine-InputWrapper-root")?.querySelector("label")?.textContent?.startsWith(label)
  );
  if (!input) throw new Error(`no input ${label}`);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("RightsSection", () => {
  it("shows the license with its deed, and marks the values from the file", async () => {
    await render({
      license: "cc-by-nc-4.0",
      license_url: "https://evil.example/",
      copyright: "© 2026 Anna Berger",
      rights_from_file: ["copyright"],
    });

    const text = container.textContent ?? "";
    expect(text).toContain("CC BY-NC 4.0");
    expect(text).toContain("© 2026 Anna Berger");
    expect(container.querySelectorAll(".mantine-Badge-root")).toHaveLength(2);
    const deed = container.querySelector("a");
    expect(deed?.getAttribute("href")).toBe("https://creativecommons.org/licenses/by-nc/4.0/");
    expect(deed?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(deed?.textContent).toContain("What Attribution-NonCommercial 4.0 International allows");
  });

  it("links no deed for all rights reserved", async () => {
    await render({ license: "all-rights-reserved" });
    expect(container.textContent).toContain("All rights reserved");
    expect(container.querySelector("a")).toBeNull();
  });

  it("offers the owner's default to a photo without rights", async () => {
    mocks.user = { default_license: "cc-by-4.0", default_creator: "Anna", default_copyright: "" };
    await render({});

    expect(container.textContent).toContain(i18n.t("rights.none"));
    await click(button("Use my default: CC BY 4.0"));

    expect(mocks.setRights).toHaveBeenCalledWith({
      selection: { image_hashes: ["h1"] },
      rights: { license: "cc-by-4.0", creator: "Anna" },
      keep: "any",
    });
  });

  it("offers nothing without a default", async () => {
    await render({});
    expect(container.querySelectorAll("button")).toHaveLength(1);
  });

  it("saves only the fields that changed", async () => {
    await render({ creator: "Anna", license: "cc0-1.0" });
    await click(button(i18n.t("rights.edit")));
    await type("Creator", "  Ben ");
    await type("Copyright", "");

    await click(button(i18n.t("lightbox.sidebar.save")));

    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.update.mock.calls[0]?.[0]).toEqual({ photoId: "p1", updates: { creator: "Ben" } });
  });

  it("an unchanged editor saves nothing", async () => {
    await render({ creator: "Anna" });
    await click(button(i18n.t("rights.edit")));
    await click(button(i18n.t("lightbox.sidebar.save")));
    expect(mocks.update).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Anna");
  });
});
