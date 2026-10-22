/**
 * "Rename files…" (#2773): a preset or a pattern of tokens, a preview of the new names with
 * thumbnails, and the rename; undated photos are skipped and can get a date from the dialog.
 */
import type { RenamePreviewResponse, RenameRow } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PhotoSelection } from "../../api_client/photos/photoSelection";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { expectDisabledWithReason } from "../common/disabledReason.test-utils";
import { RenamePhotosModal } from "./RenamePhotosModal";

type Request = { selection: PhotoSelection; pattern: string };
type Callbacks = { onSuccess?: () => void };

const stubs = vi.hoisted(() => ({
  previews: new Map<string, RenamePreviewResponse>(),
  asked: [] as Array<string | null>,
  mutate: vi.fn<(request: Request, callbacks?: Callbacks) => void>(),
  refetch: vi.fn<() => Promise<unknown>>(() => Promise.resolve()),
  error: null as unknown,
}));

vi.mock("../../api_client/photos/hooks/useRenamePreviewQuery", () => ({
  useRenamePreviewQuery: (_selection: PhotoSelection, pattern: string | null) => {
    stubs.asked.push(pattern);
    return {
      data: pattern === null ? undefined : stubs.previews.get(pattern),
      isError: stubs.error !== null,
      isFetching: false,
      error: stubs.error,
      refetch: stubs.refetch,
    };
  },
}));
vi.mock("../../api_client/photos/hooks/useRenamePhotosMutation", () => ({
  useRenamePhotosMutation: () => ({ mutate: stubs.mutate, isPending: false }),
}));
vi.mock("../photolist/ChangeDateTimeModal", () => ({
  ChangeDateTimeModal: (props: { selection: PhotoSelection; onSaved: () => void }) => (
    <button type="button" onClick={props.onSaved}>
      {`set date of ${JSON.stringify(props.selection)}`}
    </button>
  ),
}));
vi.mock("../common/MediaThumbnail", () => ({
  MediaThumbnail: ({ imageHash }: { imageHash: string }) => <span data-thumbnail={imageHash} />,
}));
// The preview is asked for at once instead of after the typing pause.
vi.mock("@mantine/hooks", async importOriginal => ({
  ...(await importOriginal<typeof import("@mantine/hooks")>()),
  useDebouncedValue: <T,>(value: T) => [value, () => {}],
}));

const SELECTION: PhotoSelection = { image_hashes: ["h1", "h2", "h3"] };
const DATE_TIME = "{year}{month}{day}_{hour}{minute}{second}";

const row = (overrides: Partial<RenameRow>): RenameRow => ({
  photo_id: "0b7a3d52-3c55-4c1f-9d7e-2b8f1e7a9c10",
  image_hash: "h1",
  name: "IMG_1.jpg",
  new_name: "20250601_233000.jpg",
  other_files: 0,
  status: "rename",
  number: 0,
  reason: null,
  ...overrides,
});

const preview = (overrides: Partial<RenamePreviewResponse> = {}): RenamePreviewResponse => ({
  photos: 2,
  files: 4,
  unchanged: 0,
  undated: 1,
  undated_hashes: ["h3"],
  numbered: 1,
  no_free_name: 0,
  refused: [],
  rows: [
    row({ other_files: 2 }),
    row({
      photo_id: "1b7a3d52-3c55-4c1f-9d7e-2b8f1e7a9c10",
      image_hash: "h2",
      name: "IMG_2.jpg",
      new_name: "20250601_233000 (1).jpg",
      number: 1,
    }),
    row({
      photo_id: "2b7a3d52-3c55-4c1f-9d7e-2b8f1e7a9c10",
      image_hash: "h3",
      name: "scan_1.png",
      new_name: null,
      status: "undated",
    }),
  ],
  ...overrides,
});

const onClose = vi.fn<() => void>();
const onDone = vi.fn<() => void>();
let root: Root;

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
  globalThis.ResizeObserver = class {
    observe() {}

    unobserve() {}

    disconnect() {}
  };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  document.body.innerHTML = "";
  stubs.previews.clear();
  stubs.previews.set(DATE_TIME, preview());
  stubs.asked.length = 0;
  stubs.error = null;
  stubs.mutate.mockReset();
  stubs.mutate.mockImplementation((_request, callbacks) => callbacks?.onSuccess?.());
  stubs.refetch.mockClear();
  onClose.mockReset();
  onDone.mockReset();
});

afterEach(async () => {
  await act(async () => root.unmount());
});

async function open() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <MantineProvider
        env="test"
        theme={{ components: { Modal: { defaultProps: { transitionProps: { duration: 0 } } } } }}
      >
        <RenamePhotosModal opened onClose={onClose} selection={SELECTION} onDone={onDone} />
      </MantineProvider>
    );
  });
}

function buttonWithText(text: string) {
  return defined(Array.from(document.querySelectorAll("button")).find(b => b.textContent === text));
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.click();
  });
}

async function typeInto(input: HTMLInputElement, value: string) {
  const setValue = defined(Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set);
  await act(async () => {
    setValue.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const patternField = () => defined(document.querySelector<HTMLInputElement>('input[aria-label="Name pattern"]'));

describe("RenamePhotosModal", () => {
  it("previews the date and time preset with thumbnails and renames", async () => {
    await open();

    expect(patternField().value).toBe(DATE_TIME);
    const table = defined(document.querySelector("table"));
    expect(table.querySelectorAll("[data-thumbnail]")).toHaveLength(3);
    expect(table.textContent).toContain("IMG_1.jpg+2 files20250601_233000.jpg");
    expect(table.textContent).toContain("20250601_233000 (1).jpgname taken");
    expect(table.textContent).toContain("scan_1.pngskipped: no date");
    expect(document.body.textContent).toContain("2 photos with 4 files get a new name.");
    expect(document.body.textContent).toContain("1 photo has no date and is skipped.");

    await click(buttonWithText("Rename 2 photos"));
    expect(defined(stubs.mutate.mock.calls[0])[0]).toEqual({ selection: SELECTION, pattern: DATE_TIME });
    expect(onClose).toHaveBeenCalled();
    expect(onDone).toHaveBeenCalled();
  });

  it("puts a token where the caret is", async () => {
    await open();
    const field = patternField();
    await act(async () => {
      field.setSelectionRange(0, 0);
    });
    await click(buttonWithText("{name}"));
    expect(patternField().value).toBe(`{name}${DATE_TIME}`);
  });

  it("refuses an unsafe pattern before asking the server", async () => {
    await open();
    await typeInto(patternField(), "../{year}");

    expect(document.body.textContent).toContain('A name has no \\ / : * ? " < > | and does not start with a dot.');
    expect(stubs.asked.at(-1)).toBeNull();
    expectDisabledWithReason(buttonWithText("Rename 0 photos"), "Enter a name pattern.");
    await typeInto(patternField(), "{nope}");
    expect(document.body.textContent).toContain("Use only the tokens below.");
  });

  it("shows the server's refusal of a pattern", async () => {
    stubs.error = new Error("network");
    stubs.previews.clear();
    await open();
    expect(document.body.textContent).toContain("The new names could not be checked.");
    expectDisabledWithReason(buttonWithText("Rename 0 photos"), "The new names could not be checked.");
  });

  it("gives the undated photos a date from the dialog and reads the preview again", async () => {
    await open();
    await click(buttonWithText("Change date and time…"));
    await click(buttonWithText('set date of {"image_hashes":["h3"]}'));
    expect(stubs.refetch).toHaveBeenCalled();
  });

  it("says why photos keep their names, and that a large rename runs in the background", async () => {
    stubs.previews.set(
      DATE_TIME,
      preview({
        photos: 0,
        files: 0,
        unchanged: 120,
        undated: 0,
        undated_hashes: [],
        numbered: 0,
        no_free_name: 1,
        refused: [{ reason: "nextcloud", photos: 2 }],
        rows: [row({ status: "refused", new_name: null, reason: "nextcloud" }), row({ status: "unchanged" })],
      })
    );
    await open();

    expect(document.body.textContent).toContain("Nextcloud copy");
    expect(document.body.textContent).toContain("120 photos already have this name.");
    expect(document.body.textContent).toContain("1 photo finds no free name and keeps its own.");
    expect(document.body.textContent).toContain("2 photos are copies of Nextcloud files and keep their names.");
    expect(document.body.textContent).toContain("The first 2 photos are shown; all are counted below.");
    expect(document.body.textContent).toContain("This runs in the background.");
    expectDisabledWithReason(buttonWithText("Rename 0 photos"), "None of the selected photos gets a new name.");
  });
});
