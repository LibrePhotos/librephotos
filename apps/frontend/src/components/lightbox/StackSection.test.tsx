/**
 * #2245: the stack thumbnails in the lightbox sidebar could only be clicked. Another photo of the stack
 * is now a named button that Tab reaches and Enter or Space press; the photo on screen says it is the
 * current one.
 */
import type { PhotoStackDetail } from "@librephotos/api-client";
import React, { act } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { renderInMantine, setUpMantineDom } from "../modals/confirmModal.test-utils";
import { StackSection } from "./StackSection";

vi.mock("../../api_client/urls", () => ({ serverAddress: "" }));
vi.mock("../stacks/StackModal", () => ({ StackModal: () => null }));

const stackPhoto = (id: string, isPrimary: boolean) => ({
  id,
  image_hash: `hash-${id}`,
  is_primary: isPrimary,
  thumbnail_url: `/thumbnails/${id}`,
  size: 2048,
  width: 4000,
  height: 3000,
});

const stack = (id: string, type: PhotoStackDetail["type"]): PhotoStackDetail => ({
  id,
  type,
  type_display: type,
  photo_count: 3,
  is_primary: false,
  photos: [stackPhoto("p1", true), stackPhoto("p2", false), stackPhoto("p3", false)],
});

/** The photo on screen is p2, the second of each stack. */
const detail = (stacks: PhotoStackDetail[]) => ({ id: "p2", stacks });

async function renderSection(stacks: PhotoStackDetail[], onPhotoSelect?: (photoId: string) => void) {
  return renderInMantine(<StackSection photoDetail={detail(stacks)} onPhotoSelect={onPhotoSelect} />);
}

const thumbnail = (container: HTMLElement, name: string) =>
  defined(container.querySelector<HTMLElement>(`[aria-label="${name}"]`), name);

beforeAll(async () => {
  setUpMantineDom();
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("StackSection thumbnails", () => {
  it("makes another photo of the stack a named button that Enter presses", async () => {
    const onPhotoSelect = vi.fn<(photoId: string) => void>();
    const { container } = await renderSection([stack("s1", "burst")], onPhotoSelect);

    const other = thumbnail(container, "Photo 3 of 3");
    expect(other.getAttribute("role")).toBe("button");
    expect(other.tabIndex).toBe(0);
    await act(async () => {
      other.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });

    expect(onPhotoSelect).toHaveBeenCalledWith("p3");
  });

  it("marks the photo on screen as current and gives it nothing to press", async () => {
    const onPhotoSelect = vi.fn<(photoId: string) => void>();
    const { container } = await renderSection([stack("s1", "burst")], onPhotoSelect);

    const current = thumbnail(container, "Photo 2 of 3");
    expect(current.getAttribute("aria-current")).toBe("true");
    expect(current.getAttribute("role")).toBe("img");
    expect(current.hasAttribute("tabindex")).toBe(false);
    current.click();
    expect(onPhotoSelect).not.toHaveBeenCalled();
  });

  it("names the photos but makes no buttons when there is nothing to switch to", async () => {
    const { container } = await renderSection([stack("s1", "burst")]);

    expect(container.querySelectorAll('[role="button"]')).toHaveLength(0);
    expect(thumbnail(container, "Photo 1 of 3").getAttribute("role")).toBe("img");
  });

  it("does the same inside the accordion of several stacks", async () => {
    const onPhotoSelect = vi.fn<(photoId: string) => void>();
    const { container } = await renderSection([stack("s1", "burst"), stack("s2", "bracket")], onPhotoSelect);

    // The first stack's panel is open
    const other = thumbnail(container, "Photo 1 of 3");
    expect(other.getAttribute("role")).toBe("button");
    await act(async () => {
      other.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    });

    expect(onPhotoSelect).toHaveBeenCalledWith("p1");
    expect(thumbnail(container, "Photo 2 of 3").getAttribute("aria-current")).toBe("true");
  });
});
