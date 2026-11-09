/**
 * How the lightbox shows the photo the address names was settled in an effect, so the render that
 * named it still had the lightbox closed and a second render opened it.
 */
import { PigPhoto } from "@librephotos/api-client";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { PigHandle } from "./PhotoListView";
import { usePhotoListLightbox } from "./usePhotoListLightbox";

const address = vi.hoisted(() => ({ photo: undefined as string | undefined }));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => () => Promise.resolve(),
  useRouter: () => ({ history: { back: () => {} } }),
  useSearch: ({ select }: { select: (search: { photo?: string }) => unknown }) => select({ photo: address.photo }),
  useLocation: () => undefined,
}));
vi.mock("../../api_client/photos/hooks", () => ({
  useFetchPhotoDetailsQuery: () => ({ data: undefined, isError: false }),
}));
vi.mock("./photoSearch", () => ({ photoListScrollRestorationKey: () => "grid" }));

const photo = (id: string) =>
  PigPhoto.parse({ id: `00000000-0000-4000-8000-00000000000${id}`, image_hash: `h${id}`, aspectRatio: 1 });
const list = [photo("1"), photo("2")];
const pig = { current: null as PigHandle<PigPhoto> | null };
const grid = { current: null as HTMLDivElement | null };

/** Whether the lightbox is open, in every render of the hook. */
const seen: boolean[] = [];
function Host() {
  seen.push(usePhotoListLightbox(list, pig, grid, { ready: true, isPublic: false }).lightboxOpen);
  return null;
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

describe("usePhotoListLightbox", () => {
  it("opens a photo of the list in the very render that names it", async () => {
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(<Host />));
    expect(seen.some(Boolean)).toBe(false);

    seen.length = 0;
    address.photo = list[1]?.id;
    await act(async () => root.render(<Host />));
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every(Boolean)).toBe(true);

    seen.length = 0;
    address.photo = undefined;
    await act(async () => root.render(<Host />));
    expect(seen.some(Boolean)).toBe(false);
    act(() => root.unmount());
  });
});
