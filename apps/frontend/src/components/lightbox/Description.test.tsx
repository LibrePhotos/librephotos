/**
 * The caption editor. Cancel used to only hide the buttons: the editor stayed
 * typeable, kept the unsaved draft on screen as if it were saved, and carried
 * both over to the next photo.
 */
import "@mantine/core/styles.css";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { Description } from "./Description";

const saveCaption = vi.fn();
const navigate = vi.hoisted(() => vi.fn());
const fetchThingsAlbums = vi.hoisted(() => vi.fn(() => ({ data: [] })));

vi.mock("../../api_client/albums/hooks", () => ({
  useFetchThingsAlbumsQuery: fetchThingsAlbums,
}));
vi.mock("../../api_client/photos/hooks", () => ({
  useSavePhotoCaptionMutation: () => ({ mutate: saveCaption }),
  useGenerateImageToTextCaptionMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("../../api_client/settings/hooks", () => ({
  useGetSettingsQuery: () => ({ data: undefined }),
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));

const photo = (hash: string, caption: string, extra: Record<string, unknown> = {}) =>
  ({ image_hash: hash, captions_json: { user_caption: caption, ...extra } }) as any;

let warn: ReturnType<typeof vi.spyOn>;

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
  // jsdom does no layout; ProseMirror measures the caret to scroll it into view
  // when the editor takes focus.
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  // @ts-ignore
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  document.body.innerHTML = "";
  saveCaption.mockReset();
  navigate.mockReset();
  warn = vi.spyOn(console, "warn");
});

afterEach(() => {
  warn.mockRestore();
});

function mount() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  return { container, root: createRoot(container) };
}

async function render(root: Root, photoDetail: unknown, isPublic = false) {
  await act(async () => {
    root.render(
      <MantineProvider>
        <Description photoDetail={photoDetail as any} isPublic={isPublic} />
      </MantineProvider>
    );
  });
}

const editorElement = (container: HTMLElement) => container.querySelector<HTMLElement>(".ProseMirror")!;

/** Types at the caret, as the user would; tiptap keeps its editor on the DOM node. */
async function type(container: HTMLElement, text: string) {
  const { view } = (editorElement(container) as any).editor;
  await act(async () => {
    view.dispatch(view.state.tr.insertText(text));
  });
}

async function clickLabelled(container: HTMLElement, label: string) {
  const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  expect(button, label).toBeTruthy();
  await act(async () => {
    button!.click();
  });
}

describe("Description", () => {
  it("shows the saved caption read-only, hashtags included", async () => {
    const { container, root } = mount();
    await render(root, photo("a", "Sunset at the #beach"));

    expect(editorElement(container).getAttribute("contenteditable")).toBe("false");
    expect(editorElement(container).textContent).toBe("Sunset at the #beach");
    expect(container.querySelector('span.hashtag[data-type="mention"]')?.textContent).toBe("#beach");
    // renderLabel is deprecated in tiptap v3 and warned on every render.
    expect(warn.mock.calls.flat().join(" ")).not.toContain("renderLabel");
  });

  it("says so when there is no caption", async () => {
    const { container, root } = mount();
    await render(root, photo("a", ""));

    expect(container.textContent).toContain("No caption");
  });

  it("is read-only again after Cancel, showing the saved caption", async () => {
    const { container, root } = mount();
    await render(root, photo("a", "Saved text"));

    await clickLabelled(container, "Edit caption");
    expect(editorElement(container).getAttribute("contenteditable")).toBe("true");
    await type(container, " and a draft");
    expect(editorElement(container).textContent).toBe("Saved text and a draft");

    await clickLabelled(container, "Cancel");
    expect(editorElement(container).getAttribute("contenteditable")).toBe("false");
    expect(editorElement(container).textContent).toBe("Saved text");
    expect(saveCaption).not.toHaveBeenCalled();
  });

  it("keeps the draft when a refetch brings a generated suggestion", async () => {
    const { container, root } = mount();
    await render(root, photo("a", "Saved text"));
    await clickLabelled(container, "Edit caption");
    await type(container, " and a draft");

    await render(root, photo("a", "Saved text", { im2txt: "A beach" }));
    expect(editorElement(container).textContent).toBe("Saved text and a draft");
    expect(container.textContent).toContain("A beach");
  });

  it("saves the draft, and writes nothing when the caption is unchanged", async () => {
    const { container, root } = mount();
    await render(root, photo("a", "Saved text"));

    // Save sits where the pencil was: a double-click on it must stay harmless.
    await clickLabelled(container, "Edit caption");
    await clickLabelled(container, "Save");
    expect(saveCaption).not.toHaveBeenCalled();
    expect(editorElement(container).getAttribute("contenteditable")).toBe("false");

    await clickLabelled(container, "Edit caption");
    await type(container, " and a draft");
    await clickLabelled(container, "Save");
    expect(saveCaption).toHaveBeenCalledWith({ id: "a", caption: "Saved text and a draft" });
  });

  it("does not carry an open editor over to the next photo", async () => {
    const { container, root } = mount();
    await render(root, photo("a", "Photo A"));
    await clickLabelled(container, "Edit caption");

    await render(root, photo("b", "Photo B"));
    expect(editorElement(container).getAttribute("contenteditable")).toBe("false");
    expect(editorElement(container).textContent).toBe("Photo B");
    expect(container.querySelector('button[aria-label="Save"]')).toBeNull();
  });

  it("searches for an auto tag, encoded, and leaves a public page's tags as labels", async () => {
    // No site settings in the test: the default tagging model's key.
    const tagged = photo("a", "", { mobileclip_s2: { tags: ["rock & roll"] } });
    const { container, root } = mount();
    await render(root, tagged);
    const badge = () => [...container.querySelectorAll<HTMLElement>(".mantine-Badge-root")].at(-1)!;
    // The owner gets the hashtag albums for the editor's suggestions.
    expect(fetchThingsAlbums).toHaveBeenLastCalledWith(false);
    // A button, so keyboard and screen-reader users can start the search too.
    expect(badge().tagName).toBe("BUTTON");

    await act(async () => badge().click());
    expect(navigate).toHaveBeenCalledWith({ to: "/search/rock%20%26%20roll" });

    // Search needs a login, which a public page's visitor has not got.
    navigate.mockReset();
    await render(root, tagged, true);
    expect(badge().tagName).not.toBe("BUTTON");
    await act(async () => badge().click());
    expect(navigate).not.toHaveBeenCalled();
    // Nor may they list the owner's hashtag albums: the query is skipped.
    expect(fetchThingsAlbums).toHaveBeenLastCalledWith(true);
  });
});
