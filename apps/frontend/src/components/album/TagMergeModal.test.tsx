/**
 * The merge-tags dialog: the tag being merged into is not offered as a source, Merge stays
 * disabled until a tag is chosen, the chosen tag is handed back, and a reopened dialog starts
 * with no tag chosen.
 */
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { TagMergeModal } from "./TagMergeModal";

type Tag = { id: number; name: string };

const tags: Tag[] = [
  { id: 1, name: "Beach" },
  { id: 2, name: "Holiday" },
  { id: 3, name: "Sunset" },
];
const onClose = vi.fn<() => void>();
const onSubmit = vi.fn<(source: Tag) => void>();

let root: Root;
let container: HTMLDivElement;

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
  // jsdom has no ResizeObserver, the Select's dropdown needs it
  globalThis.ResizeObserver = class {
    observe() {}

    unobserve() {}

    disconnect() {}
  };
  Element.prototype.scrollIntoView = () => {};
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function renderDialog(opened: boolean) {
  await act(async () => {
    root.render(
      // env="test": no transitions or portals, so the dialog and the dropdown render in place
      <MantineProvider env="test">
        <TagMergeModal opened={opened} onClose={onClose} target={defined(tags[0])} tags={tags} onSubmit={onSubmit} />
      </MantineProvider>
    );
  });
}

const select = () => defined(container.querySelector<HTMLInputElement>("input"), "the tag select");
const mergeButton = () =>
  defined(
    Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(el => el.textContent === "Merge"),
    "the Merge button"
  );

async function openOptions() {
  await act(async () => select().click());
}

const optionLabels = () => Array.from(container.querySelectorAll('[role="option"]'), option => option.textContent);

async function choose(label: string) {
  await openOptions();
  const option = defined(
    Array.from(container.querySelectorAll<HTMLElement>('[role="option"]')).find(el => el.textContent === label),
    `the ${label} option`
  );
  await act(async () => option.click());
}

describe("TagMergeModal", () => {
  it("offers every tag but the one merged into", async () => {
    await renderDialog(true);
    await openOptions();

    expect(optionLabels()).toEqual(["Holiday", "Sunset"]);
  });

  it("keeps Merge disabled until a tag is chosen, then hands it back and closes", async () => {
    await renderDialog(true);
    expect(mergeButton().disabled).toBe(true);

    await choose("Sunset");
    expect(mergeButton().disabled).toBe(false);
    await act(async () => mergeButton().click());

    expect(onSubmit).toHaveBeenCalledWith({ id: 3, name: "Sunset" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("starts with no tag chosen every time it is opened", async () => {
    await renderDialog(true);
    await choose("Holiday");

    await renderDialog(false);
    await renderDialog(true);

    expect(select().value).toBe("");
    expect(mergeButton().disabled).toBe(true);
  });
});
