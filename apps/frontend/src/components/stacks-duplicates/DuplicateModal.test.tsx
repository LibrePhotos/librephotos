import "@mantine/core/styles.css";
import type { DuplicateDetail } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { DuplicateModal } from "./DuplicateModal";

const stubs = vi.hoisted(() => ({
  duplicate: undefined as DuplicateDetail | undefined,
  resolve: vi.fn<(variables: unknown, options?: unknown) => void>(),
  dismiss: vi.fn<(id: string, options?: unknown) => void>(),
  revert: vi.fn<(id: string, options?: unknown) => void>(),
}));

vi.mock("../lightbox", () => ({ Lightbox: () => null }));
vi.mock("../../api_client/duplicates", () => ({
  useDuplicateQuery: () => ({ data: stubs.duplicate, isLoading: false }),
  useResolveDuplicateMutation: () => ({ mutate: stubs.resolve, isPending: false }),
  useDismissDuplicateMutation: () => ({ mutate: stubs.dismiss, isPending: false }),
  useRevertDuplicateMutation: () => ({ mutate: stubs.revert, isPending: false }),
}));

const group: DuplicateDetail = {
  id: "dup-1",
  duplicate_type: "exact_copy",
  duplicate_type_display: "Exact Copies",
  review_status: "pending",
  review_status_display: "Pending Review",
  photo_count: 2,
  potential_savings: 0,
  similarity_score: null,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
  kept_photo_hash: null,
  suggested_photo_hash: null,
  photos: [
    {
      id: "p1",
      image_hash: "hash-small",
      thumbnail_url: null,
      thumbnail_big_url: null,
      width: 1000,
      height: 1000,
      size: 1024 * 1024,
      exif_timestamp: null,
      camera: null,
      file_path: null,
      file_type: "JPEG",
      is_kept: false,
    },
    {
      id: "p2",
      image_hash: "hash-big",
      thumbnail_url: null,
      thumbnail_big_url: null,
      width: 3000,
      height: 2000,
      size: 3 * 1024 * 1024,
      exif_timestamp: null,
      camera: null,
      file_path: null,
      file_type: "JPEG",
      is_kept: false,
    },
  ],
};

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;

beforeAll(async () => {
  // jsdom has no matchMedia or ResizeObserver, Mantine needs both
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
}, 60000);

beforeEach(() => {
  stubs.duplicate = group;
  stubs.resolve.mockReset();
  stubs.dismiss.mockReset();
  stubs.revert.mockReset();
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
      // env="test": no transitions or portals, so the modal renders in place
      <MantineProvider env="test">
        <DuplicateModal duplicateId="dup-1" opened onClose={vi.fn<() => void>()} />
      </MantineProvider>
    );
  });
}

const button = (label: string) =>
  Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(el => el.textContent === label);

describe("DuplicateModal", () => {
  it("renders every photo of the group, with the largest one chosen", async () => {
    await render();

    expect(container.textContent).toContain("1000 × 1000");
    expect(container.textContent).toContain("3000 × 2000");
    // One card shows Keep This (the auto-chosen, highest-resolution photo), the other Select
    expect(button(i18n.t("duplicates.selected"))).toBeDefined();
    expect(button(i18n.t("duplicates.select"))).toBeDefined();
  });

  it("offers keep and not-duplicates actions, and keeping sends the chosen photo", async () => {
    await render();

    const keep = button(i18n.t("duplicates.keepandtrash"));
    const notDuplicates = button(i18n.t("duplicates.notduplicates"));
    expect(keep).toBeDefined();
    expect(keep?.disabled).toBe(false);
    expect(notDuplicates).toBeDefined();

    await act(async () => keep?.click());
    expect(stubs.resolve).toHaveBeenCalledTimes(1);
    const [variables] = stubs.resolve.mock.calls[0] ?? [];
    expect(variables).toEqual({ id: "dup-1", keep_photo_hash: "hash-big", trash_others: true });
  });
});
