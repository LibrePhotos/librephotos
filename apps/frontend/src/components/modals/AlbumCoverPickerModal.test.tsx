/**
 * The cover picker: a click on a photo makes it the cover and closes. An event's picker (#429)
 * also offers "Automatic" first and marks the cover in use; the other pickers do neither.
 */
import { Media } from "@librephotos/api-client";
import type { PigPhoto } from "@librephotos/api-client";
import React from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { AlbumCoverPickerModal } from "./AlbumCoverPickerModal";
import { click, openDialog, renderInMantine, setUpMantineDom } from "./confirmModal.test-utils";

const onSelectCover = vi.fn<(photoId: string) => void>();
const onSelectAutomatic = vi.fn<() => void>();
const onRequestClose = vi.fn<() => void>();

const tile = (id: string): PigPhoto => ({
  id,
  image_hash: `hash-${id}`,
  aspectRatio: 1,
  type: Media.IMAGE,
  is_hdr: false,
  rating: 0,
  shared_to: [],
  isTemp: false,
  has_raw_variant: false,
});

function picker(props: Partial<React.ComponentProps<typeof AlbumCoverPickerModal>> = {}) {
  return (
    <AlbumCoverPickerModal
      isOpen
      onRequestClose={onRequestClose}
      photos={[tile("p1"), tile("p2")]}
      onSelectCover={onSelectCover}
      albumTitle="Porto"
      {...props}
    />
  );
}

/** The grid's cells: the photos and the Automatic choice, not the dialog's other buttons. */
function cells(): HTMLButtonElement[] {
  return [...defined(openDialog()).querySelectorAll<HTMLButtonElement>("button")].filter(
    button => button.querySelector("img") !== null || button.textContent?.includes("Automatic")
  );
}

beforeAll(async () => {
  setUpMantineDom();
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  document.body.innerHTML = "";
  onSelectCover.mockReset();
  onSelectAutomatic.mockReset();
  onRequestClose.mockReset();
});

describe("AlbumCoverPickerModal", () => {
  it("makes the clicked photo the cover and closes", async () => {
    await renderInMantine(picker());

    await click(defined(cells()[1]));

    expect(onSelectCover).toHaveBeenCalledWith("p2");
    expect(onRequestClose).toHaveBeenCalledTimes(1);
  });

  it("offers no Automatic choice and marks nothing without them", async () => {
    await renderInMantine(picker());

    expect(openDialog()?.textContent).not.toContain("Automatic");
    expect(cells().map(cell => cell.getAttribute("aria-pressed"))).toEqual([null, null]);
  });

  it("offers Automatic first, pressed while the cover is automatic", async () => {
    await renderInMantine(picker({ currentCoverId: null, onSelectAutomatic }));

    const [automatic, ...photos] = cells();
    expect(automatic?.textContent).toContain("Automatic");
    expect(automatic?.getAttribute("aria-pressed")).toBe("true");
    expect(photos.map(cell => cell.getAttribute("aria-pressed"))).toEqual(["false", "false"]);

    await click(defined(automatic));
    expect(onSelectAutomatic).toHaveBeenCalledTimes(1);
    expect(onSelectCover).not.toHaveBeenCalled();
    expect(onRequestClose).toHaveBeenCalledTimes(1);
  });

  it("marks the picked cover instead of Automatic", async () => {
    await renderInMantine(picker({ currentCoverId: "p2", onSelectAutomatic }));

    expect(cells().map(cell => cell.getAttribute("aria-pressed"))).toEqual(["false", "false", "true"]);
  });
});
