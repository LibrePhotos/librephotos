/**
 * The All metadata dialog (#2277): a tab per file, the filter narrows the rows, Copy as JSON
 * writes the active tab's tags, a missing file says so with Try again, and the button opens it.
 */
import { ApiError, type RawMetadata } from "@librephotos/api-client";
import React, { act } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { makePhoto } from "../lightbox/photoFixture.test-utils";
import { click, openDialog, renderInMantine, setUpMantineDom } from "../modals/confirmModal.test-utils";
import { AllMetadataButton } from "./AllMetadataButton";
import { AllMetadataModal } from "./AllMetadataModal";

type QueryState = { data?: RawMetadata; error: Error | null; isFetching: boolean };

const stubs = vi.hoisted(() => {
  const state: QueryState = { error: null, isFetching: false };
  const photoIds: Array<string | undefined> = [];
  return { state, photoIds, refetch: vi.fn<() => Promise<void>>(async () => {}) };
});

vi.mock("../../api_client/photos/hooks/useRawPhotoMetadataQuery", () => ({
  useRawPhotoMetadataQuery: (photoId: string | undefined) => {
    stubs.photoIds.push(photoId);
    return { ...stubs.state, refetch: stubs.refetch };
  },
}));

const answer: RawMetadata = {
  files: [
    {
      path_label: "2024/DSCF4127.JPG",
      kind: "media",
      groups: [
        { name: "IFD0", family: "EXIF", tags: { Make: "FUJIFILM", ModifyDate: "2024:08:17 20:41:12" } },
        { name: "ExifIFD", family: "EXIF", tags: { DateTimeOriginal: "2024:08:17 20:41:12", ISO: "200" } },
        { name: "FujiFilm", family: "MakerNotes", tags: { FilmMode: "Classic Chrome" } },
      ],
    },
    {
      path_label: "2024/DSCF4127.xmp",
      kind: "sidecar",
      groups: [{ name: "XMP-xmp", family: "XMP", tags: { Rating: "5" } }],
    },
  ],
};

const writeText = vi.fn<(text: string) => Promise<void>>(async () => {});

beforeAll(async () => {
  setUpMantineDom();
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  stubs.state = { data: answer, error: null, isFetching: false };
  stubs.photoIds.length = 0;
});

afterEach(() => {
  document.body.innerHTML = "";
  writeText.mockClear();
  stubs.refetch.mockClear();
});

const dialog = () => defined(openDialog());
const tagNames = () => [...dialog().querySelectorAll('[title*=":"]')].map(cell => cell.getAttribute("title"));
const button = (label: string) =>
  defined([...dialog().querySelectorAll("button")].find(candidate => candidate.textContent?.trim() === label));

async function filter(value: string) {
  const input = defined(dialog().querySelector<HTMLInputElement>("input"));
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function renderModal(opened = true) {
  return renderInMantine(<AllMetadataModal opened={opened} onClose={() => {}} photoId="p1" fileName="DSCF4127.JPG" />);
}

describe("AllMetadataModal", () => {
  it("shows a tab per file and the media file's groups, maker notes closed", async () => {
    await renderModal();
    const tabs = [...dialog().querySelectorAll('[role="tab"]')].map(tab => tab.textContent);
    expect(tabs).toEqual(["DSCF4127.JPGMedia5", "DSCF4127.xmpSidecar1"]);
    expect(tagNames()).toEqual(["IFD0:Make", "IFD0:ModifyDate", "ExifIFD:DateTimeOriginal", "ExifIFD:ISO"]);
    expect(dialog().textContent).toContain("1 sidecar");
    expect(stubs.photoIds).toContain("p1");
  });

  it("reads nothing while closed", async () => {
    await renderModal(false);
    expect(openDialog()).toBeNull();
    expect(stubs.photoIds.every(id => id === undefined)).toBe(true);
  });

  it("opens a group from its header", async () => {
    await renderModal();
    const makerNotes = defined(
      [...dialog().querySelectorAll<HTMLElement>("button[aria-expanded]")].find(header =>
        header.textContent?.startsWith("FujiFilm")
      )
    );
    expect(makerNotes.getAttribute("aria-expanded")).toBe("false");
    await click(makerNotes);
    expect(tagNames()).toContain("FujiFilm:FilmMode");
  });

  it("narrows the rows to the tags that match the filter, and counts them", async () => {
    await renderModal();
    await filter("date");
    expect(tagNames()).toEqual(["IFD0:ModifyDate", "ExifIFD:DateTimeOriginal"]);
    expect(dialog().textContent).toContain("2 of 5 tags match");
    await filter("nothing like this");
    expect(tagNames()).toEqual([]);
    expect(dialog().textContent).toContain("No tag or value contains");
  });

  it("copies the active tab's tags as JSON", async () => {
    await renderModal();
    await click(button("Copy as JSON"));
    const media = z.record(z.string(), z.unknown()).parse(JSON.parse(defined(writeText.mock.calls[0])[0]));
    expect(media).toMatchObject({ SourceFile: "2024/DSCF4127.JPG", "IFD0:Make": "FUJIFILM" });
    expect(media).not.toHaveProperty("XMP-xmp:Rating");

    await click(defined(dialog().querySelectorAll<HTMLElement>('[role="tab"]')[1]));
    await click(button("Copy as JSON"));
    const sidecar = z.record(z.string(), z.unknown()).parse(JSON.parse(defined(writeText.mock.calls[1])[0]));
    expect(sidecar).toEqual({ SourceFile: "2024/DSCF4127.xmp", "XMP-xmp:Rating": "5" });
  });

  it("says when the file is gone from disk, with Try again", async () => {
    stubs.state = {
      error: new ApiError(
        404,
        "/photos/p1/metadata/raw/",
        "Not Found",
        { errors: [{ field: null, message: "The photo's file is not on disk.", code: "file_missing" }] },
        "The photo's file is not on disk."
      ),
      isFetching: false,
    };
    await renderModal();
    expect(dialog().textContent).toContain("The file could not be read");
    expect(dialog().textContent).toContain("The photo's file is not on disk.");
    await click(button("Try again"));
    expect(stubs.refetch).toHaveBeenCalledOnce();
  });

  it("says when ExifTool failed", async () => {
    stubs.state = { error: new Error("boom"), isFetching: false };
    await renderModal();
    expect(dialog().textContent).toContain("ExifTool could not read the file");
  });
});

describe("AllMetadataButton", () => {
  const photo = makePhoto({ image_path: ["/library/2024/DSCF4127.JPG"] });

  it("opens the dialog for the photo, loading it on first open", async () => {
    const { container } = await renderInMantine(<AllMetadataButton photo={photo} variant="button" />);
    expect(openDialog()).toBeNull();
    await click(defined(container.querySelector("button")));
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    expect(dialog().textContent).toContain("DSCF4127.JPG");
    expect(stubs.photoIds).toContain(photo.id);
  });
});
