/**
 * Organizing > Duplicates.
 *
 * - "Delete Group" and "Delete Selected" ran at once. Deleting a resolved group
 *   also throws away its Revert history, so both ask first now.
 * - The selection outlived page and filter changes, so Select All showed the
 *   wrong state and Delete Selected hit groups that were no longer on screen.
 * - The empty state said "All duplicate groups have been reviewed" even when
 *   detection had never found anything.
 */
import "@mantine/core/styles.css";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { DuplicatesPageContent } from "./DuplicatesPageContent";

const stubs = vi.hoisted(() => ({
  deleteDuplicate: vi.fn(),
  pages: {} as Record<number, { id: string }[]>,
  numPages: 1,
  stats: undefined as Record<string, number> | undefined,
}));

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("../lightbox", () => ({ Lightbox: () => null }));
vi.mock("../../api_client/auth", () => ({ useAccessToken: () => ({ data: { access: { user_id: "1" } } }) }));
vi.mock("../../api_client/user/hooks", () => ({ useFetchUserSelfDetailsQuery: () => ({ data: undefined }) }));

const duplicate = (id: string) => ({
  id,
  duplicate_type: "exact_copy",
  duplicate_type_display: "Exact Copies",
  review_status: "pending",
  review_status_display: "Pending Review",
  photo_count: 2,
  potential_savings: 0,
  similarity_score: null,
  created_at: "2026-10-01T00:00:00Z",
  kept_photo: null,
  preview_photos: [],
});

vi.mock("../../api_client/duplicates", () => {
  const idle = () => ({ mutate: vi.fn(), isPending: false });
  return {
    useDeleteDuplicateMutation: () => ({ mutate: stubs.deleteDuplicate }),
    useDetectDuplicatesMutation: idle,
    useDismissDuplicateMutation: idle,
    useResolveDuplicateMutation: idle,
    useRevertDuplicateMutation: idle,
    useDuplicateQuery: () => ({ data: undefined, isLoading: false }),
    useDuplicateStatsQuery: () => ({ data: stubs.stats }),
    useDuplicatesQuery: ({ page }: { page: number }) => {
      const results = (stubs.pages[page] ?? []).map(({ id }) => duplicate(id));
      return {
        data: { results, count: results.length * stubs.numPages, num_pages: stubs.numPages, page },
        isLoading: false,
      };
    },
  };
});

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;

beforeAll(async () => {
  // @ts-ignore - jsdom has no matchMedia, MantineProvider and useMediaQuery need it
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
  // @ts-ignore - jsdom has no ResizeObserver either (ScrollArea, SegmentedControl)
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  // @ts-ignore
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
}, 60000);

beforeEach(() => {
  stubs.deleteDuplicate.mockReset();
  stubs.pages = { 1: [{ id: "a" }, { id: "b" }], 2: [{ id: "c" }, { id: "d" }] };
  stubs.numPages = 2;
  stubs.stats = { total_duplicates: 4, pending_duplicates: 4, resolved_duplicates: 0, dismissed_duplicates: 0 };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render() {
  await act(async () => {
    root.render(
      // env="test": no transitions or portals, so menus and dialogs render in place
      <MantineProvider env="test">
        <DuplicatesPageContent />
      </MantineProvider>
    );
  });
}

const buttons = () => Array.from(container.querySelectorAll<HTMLButtonElement>("button"));
const button = (label: string) => buttons().find(el => el.textContent === label)!;
const click = async (element: Element) => {
  await act(async () => {
    (element as HTMLElement).click();
  });
};
const selectAll = () =>
  Array.from(container.querySelectorAll<HTMLInputElement>("input[type=checkbox]")).find(input =>
    input.closest("label, .mantine-Checkbox-root")?.textContent?.includes("Select All")
  )!;

describe("deleting duplicate groups", () => {
  it("asks before deleting a single group", async () => {
    await render();
    // Each card's icon-only "..." menu holds Delete Group (the filter menus have labels)
    const cardMenus = Array.from(container.querySelectorAll<HTMLButtonElement>("button[aria-haspopup=menu]")).filter(
      target => !target.textContent
    );
    await click(cardMenus[0]);
    await click(button("Delete Group"));

    expect(stubs.deleteDuplicate).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Delete duplicate group?");

    await click(button("Delete"));
    expect(stubs.deleteDuplicate).toHaveBeenCalledTimes(1);
    expect(stubs.deleteDuplicate).toHaveBeenCalledWith("a");
  });

  it("asks before deleting the selection, then deletes only that", async () => {
    await render();
    await click(selectAll());
    expect(container.textContent).toContain("2 selected");

    await click(button("Delete Selected"));
    expect(container.textContent).toContain("Delete 2 duplicate groups?");
    expect(stubs.deleteDuplicate).not.toHaveBeenCalled();

    await click(button("Delete"));
    expect(stubs.deleteDuplicate.mock.calls.map(([id]) => id)).toEqual(["a", "b"]);
    expect(container.textContent).not.toContain("2 selected");
  });

  it("does nothing when the confirmation is cancelled", async () => {
    await render();
    await click(selectAll());
    await click(button("Delete Selected"));
    await click(button("Cancel"));

    expect(stubs.deleteDuplicate).not.toHaveBeenCalled();
    expect(container.textContent).toContain("2 selected");
  });
});

describe("the selection", () => {
  it("is dropped when moving to another page", async () => {
    await render();
    await click(selectAll());
    expect(container.textContent).toContain("2 selected");

    await click(button("2"));
    expect(container.textContent).not.toContain("2 selected");
    expect(selectAll().checked).toBe(false);
    expect(selectAll().indeterminate).toBe(false);
  });
});

describe("the empty state", () => {
  it("asks to run detection when nothing was ever found", async () => {
    stubs.pages = {};
    stubs.numPages = 1;
    stubs.stats = { total_duplicates: 0, pending_duplicates: 0, resolved_duplicates: 0, dismissed_duplicates: 0 };
    await render();

    expect(container.textContent).toContain(i18n.t("duplicates.empty"));
    expect(container.textContent).not.toContain(i18n.t("duplicates.nopending"));
    // Nothing to select
    expect(container.textContent).not.toContain("Select All");
  });

  it("says everything was reviewed when only reviewed groups are left", async () => {
    stubs.pages = {};
    stubs.numPages = 1;
    stubs.stats = { total_duplicates: 3, pending_duplicates: 0, resolved_duplicates: 3, dismissed_duplicates: 0 };
    await render();

    expect(container.textContent).toContain(i18n.t("duplicates.nopending"));
  });
});
