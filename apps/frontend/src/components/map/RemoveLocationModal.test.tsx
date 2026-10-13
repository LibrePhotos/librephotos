/**
 * The removal dialog says what happens to the photo's file, following "Write edits to files":
 * a location is written back since #2290, so its removal is too.
 */
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { RemoveLocationModal } from "./RemoveLocationModal";

const mocks = vi.hoisted(() => ({ user: undefined as { save_metadata_to_disk: string } | undefined }));

vi.mock("../../api_client/user/hooks/useCurrentUserSelfDetailsQuery", () => ({
  useCurrentUserSelfDetailsQuery: () => ({ data: mocks.user }),
}));
vi.mock("../../api_client/photos/hooks/useUpdatePhotoMutation", () => ({
  useUpdatePhotoMutation: () => ({ mutate: () => {}, isPending: false }),
}));
vi.mock("../../api_client/albums/invalidatePlaces", () => ({ invalidatePlaces: () => {} }));

const REMOVED =
  "The photo leaves the map, its Places albums and location search. A rescan does not bring the location back.";

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

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

/** The dialog's text with "Write edits to files" at `mode` (none: settings not loaded yet). */
async function dialogText(mode?: string): Promise<string> {
  mocks.user = mode === undefined ? undefined : { save_metadata_to_disk: mode };
  await act(async () => {
    root.render(
      <MantineProvider withCssVariables={false} withGlobalClasses={false}>
        <RemoveLocationModal opened onClose={() => {}} imageHash="abc" onRemoved={() => {}} />
      </MantineProvider>
    );
  });
  return document.body.textContent ?? "";
}

describe("RemoveLocationModal", () => {
  it("says the photo file is not changed while writing is Off", async () => {
    expect(await dialogText("OFF")).toContain(`${REMOVED} The photo file is not changed.`);
  });

  it("says the location also leaves the photo file with Save to media file", async () => {
    expect(await dialogText("MEDIA_FILE")).toContain(`${REMOVED} The location is also removed from the photo file.`);
  });

  it("says the sidecar loses it and the photo file keeps its own with Save to sidecar", async () => {
    expect(await dialogText("SIDECAR_FILE")).toContain(
      `${REMOVED} The location is also removed from the sidecar file. A location stored in the photo file itself stays there.`
    );
  });

  it("says nothing about the file before the user's settings are loaded", async () => {
    const text = await dialogText();
    expect(text).toContain(REMOVED);
    expect(text).not.toContain("photo file");
  });
});
