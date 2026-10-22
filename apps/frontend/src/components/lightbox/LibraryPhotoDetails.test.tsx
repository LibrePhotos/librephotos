/**
 * A photo of a library someone shares with me (#2731), in the lightbox: whose it is, and for each
 * field the owner does not share, a line that says so instead of an empty section.
 */
import type { LibraryGrant } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import type { LibraryPhoto } from "../libraryShare/libraryShareFields";
import { LibraryPhotoDetails } from "./LibraryPhotoDetails";
import { makePhoto } from "./photoFixture.test-utils";

vi.mock("./TimestampItem", () => ({ TimestampItem: () => <p>date</p> }));
vi.mock("./LocationSection", () => ({ LocationSection: () => <p>location section</p> }));
vi.mock("./PeopleSection", () => ({ PeopleSection: () => <p>people section</p> }));
vi.mock("./CameraInfoSection", () => ({ CameraInfoSection: () => <p>camera section</p> }));
vi.mock("./Description", () => ({ Description: () => <p>description section</p> }));

const NOTHING: LibraryGrant = { location: false, people: false, camera: false, captions: false, originals: false };

let root: ReturnType<typeof createRoot> | undefined;

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
  await i18n.changeLanguage("en");
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

async function render(grant: LibraryGrant) {
  const photo: LibraryPhoto = {
    ...makePhoto({
      owner: { id: 1, username: "anna", first_name: "Anna", last_name: "Berger" },
      people: [
        {
          name: "Clara",
          type: "user",
          probability: 1,
          location: { top: 0, bottom: 0, left: 0, right: 0 },
          face_url: "",
          face_id: 1,
        },
      ],
      camera: "Pixel 8",
      image_hash: "h",
    }),
    shared_library: grant,
  };
  const container = document.createElement("div");
  document.body.appendChild(container);
  const mounted = createRoot(container);
  root = mounted;
  await act(async () =>
    mounted.render(
      <MantineProvider env="test">
        <LibraryPhotoDetails photo={photo} setFaceLocation={() => {}} />
      </MantineProvider>
    )
  );
  return container.textContent ?? "";
}

describe("LibraryPhotoDetails", () => {
  it("says whose photo it is and what the owner does not share", async () => {
    const text = await render(NOTHING);
    expect(text).toContain("Anna Berger's photo");
    expect(text).toContain("Shared with you, read-only");
    expect(text).toContain("Anna doesn't share locations with you");
    expect(text).toContain("Anna doesn't share people's names with you");
    expect(text).toContain("Anna doesn't share camera information with you");
    expect(text).toContain("Anna doesn't share captions with you");
    expect(text).toContain("Downloads are full-size copies without the file's metadata.");
    expect(document.querySelector("a[download]")?.getAttribute("download")).toBe("h.jpg");
    expect(text).not.toContain("location section");
  });

  it("shows each section the owner shares", async () => {
    const text = await render({ location: true, people: true, camera: true, captions: true, originals: true });
    for (const section of ["location section", "people section", "camera section", "description section"]) {
      expect(text).toContain(section);
    }
    expect(text).not.toContain("doesn't share");
    expect(text).not.toContain("copies without");
  });
});
