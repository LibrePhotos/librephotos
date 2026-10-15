import type { DuplicatePhoto } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { DuplicatePhotoCard } from "./DuplicatePhotoCard";

const photo: DuplicatePhoto = {
  id: "p1",
  image_hash: "hash-1",
  thumbnail_url: null,
  thumbnail_big_url: null,
  width: 4032,
  height: 3024,
  size: 2_500_000,
  exif_timestamp: null,
  camera: null,
  file_path: null,
  file_type: "JPEG",
  is_kept: false,
};

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;

beforeAll(async () => {
  // jsdom has no matchMedia or ResizeObserver, Mantine needs both
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
}, 60000);

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render(props: Partial<Parameters<typeof DuplicatePhotoCard>[0]> = {}) {
  await act(async () => {
    root.render(
      <MantineProvider env="test">
        <DuplicatePhotoCard
          photo={photo}
          isSelected={false}
          onSelect={vi.fn<() => void>()}
          onViewFull={vi.fn<() => void>()}
          {...props}
        />
      </MantineProvider>
    );
  });
}

const button = (label: string) =>
  Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(el => el.textContent === label);

describe("DuplicatePhotoCard", () => {
  it("shows the resolution and the file size", async () => {
    await render();

    expect(container.textContent).toContain("4032 × 3024");
    expect(container.textContent).toContain("2.5 MB");
    expect(container.textContent).toContain("JPEG");
  });

  it("offers Select on a photo that is not chosen, and reports the click", async () => {
    const onSelect = vi.fn<() => void>();
    await render({ onSelect });

    expect(container.querySelector("[data-selected]")).toBeNull();
    const select = button(i18n.t("duplicates.select"));
    expect(select).toBeDefined();
    await act(async () => select?.click());
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("marks the chosen photo as selected", async () => {
    await render({ isSelected: true });

    expect(container.querySelector("[data-selected]")).not.toBeNull();
    expect(button(i18n.t("duplicates.selected"))).toBeDefined();
    expect(button(i18n.t("duplicates.select"))).toBeUndefined();
  });

  it("hides the select button when the group is already reviewed", async () => {
    await render({ showSelectButton: false });

    expect(button(i18n.t("duplicates.select"))).toBeUndefined();
    expect(button(i18n.t("duplicates.selected"))).toBeUndefined();
  });
});
