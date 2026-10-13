/**
 * The keyword editor split on space as well as comma, so "Golden Gate" was saved
 * as the two keywords "Golden" and "Gate".
 */
import "@mantine/core/styles.css";
import { MantineProvider } from "@mantine/core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { KeywordsSection } from "./KeywordsSection";
import { makePhoto } from "./photoFixture.test-utils";

type MetadataUpdate = { photoId: string; updates: { keywords?: string[] } };

const updateMetadata = vi.hoisted(() => vi.fn<(variables: MetadataUpdate) => void>());

vi.mock("../../api_client/photos/hooks", () => ({
  useFetchPhotoMetadataQuery: () => ({ data: { keywords: [] } }),
  useUpdatePhotoMetadataMutation: () => ({ mutate: updateMetadata, isPending: false }),
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn<(options: { to: string }) => void>() }));

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
  // jsdom has no ResizeObserver, the suggestion dropdown's scroll area needs it
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
  updateMetadata.mockReset();
});

async function openEditor() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  await act(async () => {
    root.render(
      <MantineProvider>
        <KeywordsSection photoDetail={makePhoto({ image_hash: "a" })} />
      </MantineProvider>
    );
  });
  await clickLabelled(container, "Edit keywords");
  return container;
}

async function clickLabelled(container: HTMLElement, label: string) {
  const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  expect(button, label).toBeTruthy();
  await act(async () => {
    defined(button).click();
  });
}

const input = (container: HTMLElement) =>
  defined(container.querySelector<HTMLInputElement>('input:not([type="hidden"])'));

/** Sets the field's text the way typing or pasting does, so React sees a change. */
async function enterText(container: HTMLElement, text: string) {
  const field = input(container);
  const setValue = defined(Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set);
  await act(async () => {
    // Mantine ignores changes to a field that has no focus (autofill, extensions).
    field.focus();
    setValue.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function paste(container: HTMLElement, text: string) {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: { getData: () => text } });
  await act(async () => {
    input(container).focus();
    input(container).dispatchEvent(event);
  });
}

async function pressEnter(container: HTMLElement) {
  await act(async () => {
    input(container).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  });
}

async function saveAndGetKeywords(container: HTMLElement) {
  await clickLabelled(container, "Save");
  expect(updateMetadata).toHaveBeenCalledTimes(1);
  return defined(updateMetadata.mock.calls[0])[0].updates.keywords;
}

describe("KeywordsSection", () => {
  it("keeps a multi-word keyword as one keyword", async () => {
    const container = await openEditor();
    await enterText(container, "Golden Gate");
    await pressEnter(container);

    expect(await saveAndGetKeywords(container)).toEqual(["Golden Gate"]);
  });

  it("splits pasted text on commas only", async () => {
    const container = await openEditor();
    await paste(container, "Golden Gate, Bridge");

    expect(await saveAndGetKeywords(container)).toEqual(["Golden Gate", "Bridge"]);
  });

  it("saves keywords trimmed", async () => {
    const container = await openEditor();
    await enterText(container, "  New York  ");
    await pressEnter(container);

    expect(await saveAndGetKeywords(container)).toEqual(["New York"]);
  });
});
