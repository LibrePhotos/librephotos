import { MantineProvider } from "@mantine/core";
import { Settings } from "luxon";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PhotoStack } from "../../api_client/stacks/types";
import i18n from "../../i18n";
import { StackModal } from "./StackModal";

const stubs = vi.hoisted(() => ({ stack: undefined as unknown }));

vi.mock("../../api_client/stacks", () => ({
  useStackQuery: () => ({ data: stubs.stack, isLoading: false }),
  useSetCoverPhotoMutation: () => ({ mutate: vi.fn<(args: unknown) => void>() }),
}));

// One photo, taken on 21 September 2023 at 14:30 wall clock (stored as UTC, like every exif_timestamp).
const stack = PhotoStack.parse({
  id: "stack-1",
  stack_type: "burst",
  stack_type_display: "Burst",
  photo_count: 1,
  sequence_start: null,
  sequence_end: null,
  created_at: "2023-09-21T14:30:00Z",
  updated_at: "2023-09-21T14:30:00Z",
  primary_photo_hash: "hash-1",
  photos: [
    {
      id: "photo-1",
      image_hash: "hash-1",
      thumbnail_url: null,
      thumbnail_big_url: null,
      width: 4000,
      height: 3000,
      size: 2048,
      exif_timestamp: "2023-09-21T14:30:00Z",
      camera: null,
      file_path: null,
      file_type: null,
      is_primary: true,
    },
  ],
});

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;

beforeAll(async () => {
  // jsdom has no matchMedia or ResizeObserver; Mantine's Modal and ScrollArea need them.
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
}, 60000);

beforeEach(() => {
  stubs.stack = stack;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  await i18n.changeLanguage("en");
});

async function renderModal() {
  await act(async () => {
    root.render(
      // env="test": no transitions, so the modal's content is there straight away
      <MantineProvider env="test">
        <StackModal stackId="stack-1" opened onClose={() => {}} />
      </MantineProvider>
    );
  });
}

describe("StackModal photo dates", () => {
  it("shows a photo's date in the UI language, not the browser's", async () => {
    // Start from a browser locale that is not German, so the switch alone must
    // bring the German format (the machine running the tests may be German).
    Settings.defaultLocale = "en-US";
    await i18n.changeLanguage("de");
    await renderModal();

    // The modal portals into the body. German short date: 21.9.2023; the browser's
    // en-US would have written 9/21/2023.
    expect(document.body.textContent).toContain("21.9.2023");
    expect(document.body.textContent).not.toContain("9/21/2023");
  });
});
