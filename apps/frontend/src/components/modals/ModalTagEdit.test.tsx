/**
 * The bulk tag dialog: type comma-separated names, hit Add, and every selected
 * photo gets every tag.
 *
 * What is worth guarding here is the request shape, because the dialog is the
 * only place that fans one typed line out over several endpoints:
 *   - a name the account already owns must not be re-created,
 *   - a new name is POSTed to /tags/ once and then used by id,
 *   - each name gets exactly one /tags/<id>/add/ call carrying the whole
 *     selection, not one call per photo,
 *   - in select-all mode the selection is the query, and `selectedImages`
 *     holds the EXCLUDED photos instead.
 */
import "@mantine/core/styles.css";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { ModalTagEdit } from "./ModalTagEdit";

const stubs = vi.hoisted(() => ({
  post: vi.fn(),
  tags: [
    { id: 7, name: "beach", photo_count: 2, cover_photos: [] },
    { id: 8, name: "holiday", photo_count: 5, cover_photos: [] },
  ],
  taggedPhotos: vi.fn(),
}));

vi.mock("../../api_client/apiClient", () => ({ serverAddress: "" }));
vi.mock("../../service/notifications", () => ({
  notification: new Proxy(
    {},
    {
      get: (_target, name) => (name === "taggedPhotos" ? stubs.taggedPhotos : () => {}),
    }
  ),
}));
vi.mock("../../api_client/tags/hooks/useFetchTagsQuery", () => ({
  TagsQueryKeys: ["tags"],
  useFetchTagsQuery: () => ({ data: stubs.tags }),
}));
vi.mock("../../api_client/api", () => ({
  fetchClient: { post: stubs.post },
  queryClient: {
    invalidateQueries: () => {},
    // The cached list is the shortcut past a create request.
    getQueryData: () => stubs.tags,
  },
}));

beforeAll(async () => {
  // @ts-ignore - jsdom has no matchMedia, MantineProvider needs it
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
  // @ts-ignore - jsdom has no ResizeObserver, the modal needs it
  globalThis.ResizeObserver = class {
    observe() {}

    unobserve() {}

    disconnect() {}
  };
  // @ts-ignore
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  stubs.post.mockReset();
  stubs.post.mockResolvedValue({ id: 99, name: "new", photo_count: 0 });
  stubs.taggedPhotos.mockReset();
});

const selection = [
  { id: "photo-1", image_hash: "a".repeat(32), type: "photo" },
  { id: "photo-2", image_hash: "b".repeat(32), type: "video" },
];

/** React tracks the previous value on the node itself, so plain assignment is swallowed. */
function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

/** TagsInput renders a hidden input for the committed value; the first one is the search box. */
function tagInput(): HTMLInputElement {
  return document.querySelector("input") as HTMLInputElement;
}

function pressKey(key: string) {
  tagInput().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
}

function addButton(): HTMLButtonElement {
  return Array.from(document.querySelectorAll("button")).find(
    button => button.textContent === "Add tags"
  ) as HTMLButtonElement;
}

type RenderOptions = {
  selectAllMode?: boolean;
  selectAllQuery?: Record<string, unknown>;
  totalCount?: number;
  selectedImages?: typeof selection;
};

async function renderModal(options: RenderOptions = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let closed = false;

  function Harness() {
    const [isOpen, setIsOpen] = useState(true);
    return (
      <ModalTagEdit
        isOpen={isOpen}
        onRequestClose={() => {
          closed = true;
          setIsOpen(false);
        }}
        selectedImages={options.selectedImages ?? selection}
        selectAllMode={options.selectAllMode}
        selectAllQuery={options.selectAllQuery as never}
        totalCount={options.totalCount}
      />
    );
  }

  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
        <MantineProvider>
          <Harness />
        </MantineProvider>
      </QueryClientProvider>
    );
  });

  return {
    /**
     * Type a line the way the user does. TagsInput turns text into a pill on
     * the keydown of a split char, so a comma has to arrive as a keystroke --
     * assigning the whole line at once would leave it as one long tag.
     */
    async type(line: string) {
      const segments = line.split(",");
      for (let index = 0; index < segments.length; index += 1) {
        // eslint-disable-next-line no-await-in-loop
        await act(async () => {
          setInputValue(tagInput(), segments[index]);
        });
        if (index < segments.length - 1) {
          // eslint-disable-next-line no-await-in-loop
          await act(async () => {
            pressKey(",");
          });
        }
      }
    },
    async pressEnter() {
      await act(async () => {
        pressKey("Enter");
      });
    },
    async submit() {
      await act(async () => {
        addButton().click();
      });
    },
    wasClosed: () => closed,
    async unmount() {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

describe("ModalTagEdit", () => {
  it("reuses a tag the account already owns instead of creating it again", async () => {
    const modal = await renderModal();
    await modal.type("beach,");
    await modal.submit();

    expect(stubs.post).toHaveBeenCalledTimes(1);
    expect(stubs.post).toHaveBeenCalledWith("/tags/7/add/", {
      photos: ["photo-1", "photo-2"],
    });
    await modal.unmount();
  });

  it("creates a tag it has never seen, then tags with the id it got back", async () => {
    stubs.post.mockResolvedValueOnce({ id: 42, name: "sunset", photo_count: 0 });

    const modal = await renderModal();
    await modal.type("sunset,");
    await modal.submit();

    expect(stubs.post.mock.calls[0]).toEqual(["/tags/", { name: "sunset" }]);
    expect(stubs.post.mock.calls[1]).toEqual(["/tags/42/add/", { photos: ["photo-1", "photo-2"] }]);
    await modal.unmount();
  });

  it("splits a comma-separated line into one add per tag, each with the whole selection", async () => {
    const modal = await renderModal();
    await modal.type("beach, holiday,");
    await modal.submit();

    expect(stubs.post.mock.calls).toEqual([
      ["/tags/7/add/", { photos: ["photo-1", "photo-2"] }],
      ["/tags/8/add/", { photos: ["photo-1", "photo-2"] }],
    ]);
    await modal.unmount();
  });

  it("trims and dedupes what was typed", async () => {
    const modal = await renderModal();
    await modal.type("  beach , beach,");
    await modal.submit();

    expect(stubs.post.mock.calls).toEqual([["/tags/7/add/", { photos: ["photo-1", "photo-2"] }]]);
    await modal.unmount();
  });

  it("sends the select-all payload instead of a photo list, with the unchecked photos excluded", async () => {
    const modal = await renderModal({
      selectAllMode: true,
      selectAllQuery: { person: 3 },
      totalCount: 150000,
    });
    await modal.type("beach,");
    await modal.submit();

    expect(stubs.post).toHaveBeenCalledWith("/tags/7/add/", {
      select_all: true,
      query: { person: 3 },
      excluded_hashes: ["a".repeat(32), "b".repeat(32)],
    });
    await modal.unmount();
  });

  it("reports the edit once, however many tags it applied", async () => {
    const modal = await renderModal();
    await modal.type("beach, holiday,");
    await modal.submit();

    expect(stubs.taggedPhotos).toHaveBeenCalledTimes(1);
    expect(stubs.taggedPhotos).toHaveBeenCalledWith(["beach", "holiday"], 2);
    await modal.unmount();
  });

  it("keeps the dialog open when the save fails, so the typing is not lost", async () => {
    stubs.post.mockRejectedValueOnce(new Error("boom"));

    const modal = await renderModal();
    await modal.type("beach,");
    await modal.submit();

    expect(modal.wasClosed()).toBe(false);
    expect(stubs.taggedPhotos).not.toHaveBeenCalled();
    await modal.unmount();
  });

  it("takes a tag that was typed but never committed to a pill", async () => {
    // The most common case of all: one tag, no comma, straight to the button.
    const modal = await renderModal();
    await modal.type("beach");
    await modal.submit();

    expect(stubs.post.mock.calls).toEqual([["/tags/7/add/", { photos: ["photo-1", "photo-2"] }]]);
    await modal.unmount();
  });

  it("submits on Enter once the box is empty, and not while a name is still being typed", async () => {
    const modal = await renderModal();
    await modal.type("beach");
    // This Enter is TagsInput committing the pill, not a submit.
    await modal.pressEnter();
    expect(stubs.post).not.toHaveBeenCalled();

    await modal.pressEnter();
    expect(stubs.post.mock.calls).toEqual([["/tags/7/add/", { photos: ["photo-1", "photo-2"] }]]);
    await modal.unmount();
  });

  it("will not fire with nothing typed", async () => {
    const modal = await renderModal();
    await modal.submit();

    expect(stubs.post).not.toHaveBeenCalled();
    await modal.unmount();
  });
});
