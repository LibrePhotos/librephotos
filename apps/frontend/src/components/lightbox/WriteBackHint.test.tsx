/**
 * The hint under each editor of the info panel says whether the edit reaches the photo's file,
 * following "Write edits to files" (#2281).
 */
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import type { EditedField } from "../settings/metadataWrite";
import { WriteBackHint } from "./WriteBackHint";

const mocks = vi.hoisted(() => ({ user: undefined as { save_metadata_to_disk: string } | undefined }));

vi.mock("../../api_client/user/hooks/useCurrentUserSelfDetailsQuery", () => ({
  useCurrentUserSelfDetailsQuery: () => ({ data: mocks.user }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, hash, children, ...rest }: { to: string; hash: string; children?: React.ReactNode }) => (
    <a href={`${to}#${hash}`} {...rest}>
      {children}
    </a>
  ),
}));

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

async function renderHint(field: EditedField, mode?: string) {
  mocks.user = mode === undefined ? undefined : { save_metadata_to_disk: mode };
  await act(async () => {
    root.render(
      // No style elements: the assertions read the container's text.
      <MantineProvider withCssVariables={false} withGlobalClasses={false}>
        <WriteBackHint field={field} />
      </MantineProvider>
    );
  });
  return container.textContent ?? "";
}

describe("WriteBackHint", () => {
  it("says a date is written to the sidecar with Save to sidecar", async () => {
    expect(await renderHint("date", "SIDECAR_FILE")).toBe(
      "Saved in LibrePhotos and written to the sidecar file. Settings"
    );
  });

  it("says a date is written to the photo file with Save to media file", async () => {
    expect(await renderHint("date", "MEDIA_FILE")).toContain("Saved in LibrePhotos and written to the photo file.");
  });

  it("says a caption and a location are written too (#2289, #2290)", async () => {
    expect(await renderHint("caption", "SIDECAR_FILE")).toContain("written to the sidecar file.");
    expect(await renderHint("location", "MEDIA_FILE")).toContain("written to the photo file.");
  });

  it("says tags are written too (#2289)", async () => {
    expect(await renderHint("tags", "SIDECAR_FILE")).toContain("written to the sidecar file.");
    expect(await renderHint("tags", "MEDIA_FILE")).toContain("written to the photo file.");
    expect(await renderHint("tags", "OFF")).toContain("Saved in LibrePhotos only.");
  });

  it("says a date stays in LibrePhotos while writing is Off", async () => {
    expect(await renderHint("date", "OFF")).toContain("Saved in LibrePhotos only.");
  });

  it("links to the setting", async () => {
    await renderHint("location", "MEDIA_FILE");
    const link = container.querySelector("a");
    expect(link?.textContent).toBe("Settings");
    expect(link?.getAttribute("href")).toBe("/settings#settings-metadata");
  });

  it("says nothing before the user's settings are loaded", async () => {
    expect(await renderHint("date")).toBe("");
  });
});
