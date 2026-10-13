/**
 * The "+N more" list of a folder page kept every loaded subfolder mounted, a button each, as its
 * infinite query appended pages. It mounts at most FOLDER_LIST_CAP of them now; the filter reaches
 * the rest.
 */
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { FOLDER_LIST_CAP, FolderListModal } from "./FolderListModal";

const { subfolders } = vi.hoisted(() => ({
  subfolders: Array.from({ length: 2000 }, (_unused, i) => ({
    name: `folder-${i}`,
    path: `/photos/folder-${i}`,
    photo_count: 1,
  })),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a>,
}));
vi.mock("../../api_client/albums/hooks", () => {
  const result = {
    data: { pages: [{ results: subfolders }] },
    fetchNextPage: () => {},
    hasNextPage: false,
    isFetchingNextPage: false,
  };
  return { useFetchFolderSubfoldersInfiniteQuery: () => result };
});

let root: Root | undefined;
let container: HTMLDivElement;

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
  // The dialog's ScrollArea measures its viewport; jsdom has no ResizeObserver.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  await i18n.changeLanguage("en");
});

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
});

async function renderDialog() {
  container = document.createElement("div");
  document.body.appendChild(container);
  const dialogRoot = createRoot(container);
  root = dialogRoot;
  await act(async () => {
    dialogRoot.render(
      <MantineProvider>
        <FolderListModal opened onClose={() => {}} folderPath="/photos" isMobile={false} />
      </MantineProvider>
    );
  });
}

// The dialog renders into a portal on the body
const folderLinks = () => Array.from(document.querySelectorAll<HTMLAnchorElement>("a[title^='/photos/folder-']"));

async function filter(value: string) {
  const input = document.querySelector<HTMLInputElement>(".mantine-Modal-body input");
  if (!input) throw new Error("the filter is not rendered");
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

// Legitimately heavy: each test mounts the capped list itself, 100 links in a focus-trapped modal,
// about 1.3 s of CPU in React's development build. The default 5 s left no room on a busy machine.
describe("FolderListModal", { timeout: 15_000 }, () => {
  it("mounts at most the cap of 2000 loaded subfolders, and says so", async () => {
    await renderDialog();

    expect(folderLinks()).toHaveLength(FOLDER_LIST_CAP);
    expect(document.body.textContent).toContain(
      i18n.t("folder_list_capped", { shown: FOLDER_LIST_CAP, count: subfolders.length })
    );
  });

  it("finds a subfolder past the cap through the filter", async () => {
    await renderDialog();
    await filter("folder-1999");

    expect(folderLinks().map(link => link.title)).toEqual(["/photos/folder-1999"]);
    expect(document.body.textContent).not.toContain("Showing the first");
  });
});
