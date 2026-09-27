/**
 * The "no timestamp" page lays out a placeholder per photo from the first page's count and
 * splices each page of 100 into its slots as the user scrolls to it.
 *
 * The query keeps the previous page's photos as placeholder data while the next one loads.
 * Those must not be spliced in at the new page's offset, or the list shows the previous page
 * twice until the real one lands.
 *
 * The leading "-" keeps the TanStack router plugin from treating this file as a route.
 */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";

type PageResult = { data?: { count: number; results: { id: string }[] }; isPlaceholderData: boolean };

const stubs = vi.hoisted(() => ({
  component: undefined as React.ComponentType | undefined,
  pages: {} as Record<number, PageResult>,
  requestedPages: [] as number[],
  photoset: [] as { id: string; isTemp?: boolean }[],
  updateItems: undefined as ((visible: unknown[]) => void) | undefined,
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options?: { component?: React.ComponentType }) => {
    stubs.component = options?.component;
    return {};
  },
}));
vi.mock("../../api_client/photos/hooks/useFetchPhotosWithoutTimestampQuery", () => ({
  useFetchPhotosWithoutTimestampQuery: (page: number) => {
    stubs.requestedPages.push(page);
    return { status: "success", ...stubs.pages[page] };
  },
}));
vi.mock("../../components/photolist/PhotoListView", () => ({
  PhotoListView: ({ photoset, updateItems }: any) => {
    stubs.photoset = photoset;
    stubs.updateItems = updateItems;
    return null;
  },
}));

const photos = (page: number) => Array.from({ length: 100 }, (_unused, i) => ({ id: `p${page}-${i}` }));

beforeAll(async () => {
  // @ts-ignore
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
  // The cold import of the route takes seconds, longer when the suite runs in parallel
  await import("./notimestamp");
}, 30_000);

describe("the no-timestamp page", () => {
  it("fills each page into its own slots and ignores the placeholder of the previous page", async () => {
    const page1 = { count: 250, results: photos(1) };
    stubs.pages = { 1: { data: page1, isPlaceholderData: false } };
    const NoTimestamp = stubs.component!;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(<NoTimestamp />);
    });
    expect(stubs.photoset).toHaveLength(250);
    expect(stubs.photoset[0].id).toBe("p1-0");
    expect(stubs.photoset[100].isTemp).toBe(true);

    // Scrolling reaches the placeholders of page 2, which is still loading
    stubs.pages[2] = { data: page1, isPlaceholderData: true };
    await act(async () => {
      stubs.updateItems!([{ id: "temp-150", isTemp: true }]);
    });
    expect(stubs.requestedPages.at(-1)).toBe(2);
    expect(stubs.photoset[100].isTemp).toBe(true);
    expect(stubs.photoset.filter(photo => photo.id === "p1-0")).toHaveLength(1);

    // Page 2 arrives
    stubs.pages[2] = { data: { count: 250, results: photos(2) }, isPlaceholderData: false };
    await act(async () => {
      root.render(<NoTimestamp />);
    });
    expect(stubs.photoset).toHaveLength(250);
    expect(stubs.photoset[0].id).toBe("p1-0");
    expect(stubs.photoset[100].id).toBe("p2-0");
    expect(stubs.photoset[199].id).toBe("p2-99");
    expect(stubs.photoset[200].isTemp).toBe(true);

    await act(async () => {
      root.unmount();
    });
  });
});
