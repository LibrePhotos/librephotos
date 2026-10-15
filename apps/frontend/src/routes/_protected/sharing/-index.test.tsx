/**
 * The Sharing overview. Its Public Links row (#2241): photo share links and public photos had a
 * cover and nothing else, so they were shorter than the album cards beside them and did not say
 * what they were. Every card now has a caption: "Share link" and when it was made, "Public photo"
 * and when it was taken. The other sections keep their previews, placeholders and empty notes.
 *
 * The public photos come from their own page of the server's answer, with its count (#2686): read
 * through the public day list, every day not loaded yet was placeholders, and the overview showed
 * and counted none. The day list is not mocked here, so reading it again would fail these tests.
 *
 * The leading "-" keeps the TanStack router plugin from treating this file as a route.
 */
import { Media } from "@librephotos/api-client";
import type {
  ListUser,
  MyPublicPhotosResponse,
  PhotoShareLink,
  PigPhoto,
  UserAlbumInfo,
} from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import { DateTime } from "luxon";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../../i18n";
import { defined } from "../../../util/defined.test-utils";

type PhotoGroup = { userId: number; photos: PigPhoto[] };
type AlbumGroup = { user_id: number; albums: UserAlbumInfo[] };

const stubs = vi.hoisted(() => ({
  component: undefined as React.ComponentType | undefined,
  loading: false,
  users: [] as ListUser[],
  albums: [] as UserAlbumInfo[],
  shares: [] as PhotoShareLink[],
  publicPhotos: { count: 0, next: null, previous: null, results: [] } as MyPublicPhotosResponse,
  publicPhotosPageSize: undefined as number | undefined,
  photosWithMe: [] as PhotoGroup[],
  albumsWithMe: [] as AlbumGroup[],
  photosByMe: [] as PhotoGroup[],
  albumsByMe: [] as AlbumGroup[],
}));

// While loading, a query has no data yet
function answer<T>(data: T) {
  return { data: stubs.loading ? undefined : data, isLoading: stubs.loading };
}

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: { component?: React.ComponentType }) => {
    stubs.component = options.component;
    return {};
  },
  Link: ({ children, to, className }: { children: React.ReactNode; to: string; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));
vi.mock("../../../api_client/user/hooks", () => ({
  useFetchUserListQuery: () => answer(stubs.users),
}));
vi.mock("../../../api_client/albums/hooks", () => ({
  useFetchSharedAlbumsByMeQuery: () => answer(stubs.albumsByMe),
  useFetchSharedAlbumsWithMeQuery: () => answer(stubs.albumsWithMe),
  useFetchUserAlbumsQuery: () => answer(stubs.albums),
}));
vi.mock("../../../api_client/photos/hooks", () => ({
  useFetchMyPublicPhotosQuery: (pageSize: number) => {
    stubs.publicPhotosPageSize = pageSize;
    return answer(stubs.publicPhotos);
  },
  useFetchPhotoSharesQuery: () => answer(stubs.shares),
  useFetchSharedPhotosByMeQuery: () => answer(stubs.photosByMe),
  useFetchSharedPhotosWithMeQuery: () => answer(stubs.photosWithMe),
}));
vi.mock("../../../components/sharing/ModalAlbumShare", () => ({
  ModalAlbumShare: ({ isOpen, albumID, ownerUsername }: { isOpen: boolean; albumID: string; ownerUsername: string }) =>
    isOpen ? <div data-testid="share-dialog">{`${albumID} of ${ownerUsername}`}</div> : null,
}));

const OWNER = { id: 1, username: "anna", first_name: "", last_name: "" };

const album = (id: number, title: string): UserAlbumInfo => ({
  id,
  title,
  cover_photo: { image_hash: `cover${id}`, video: false },
  photo_count: 4,
  owner: OWNER,
  shared_to: [],
  created_on: "2024-01-01T00:00:00Z",
  favorited: false,
  locked: false,
  public: true,
  collection_ids: [],
});

const share = (slug: string, createdAt: string): PhotoShareLink => ({
  enabled: true,
  slug,
  url: `https://photos.example/p/${slug}`,
  created_at: createdAt,
  photo_id: `photo-${slug}`,
  image_hash: `hash-${slug}`,
});

const photo = (id: string, date: string | null): PigPhoto => ({
  id,
  image_hash: id,
  date,
  aspectRatio: 1,
  type: Media.IMAGE,
  is_hdr: false,
  rating: 0,
  shared_to: [],
  isTemp: false,
  has_raw_variant: false,
});

const user = (id: number, username: string, publicSharing: boolean, first = "", last = ""): ListUser => ({
  id,
  username,
  first_name: first,
  last_name: last,
  public_photo_count: 1,
  public_photo_samples: [],
  public_sharing: publicSharing,
});

/** The first page of my public photos, as GET /api/photos/public/ answers it. */
const publicPage = (count: number, results: PigPhoto[]): MyPublicPhotosResponse => ({
  count,
  next: count > results.length ? "/api/photos/public/?page=2&page_size=6" : null,
  previous: null,
  results,
});

let root: Root | undefined;

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
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
  await import("./index");
}, 30_000);

beforeEach(() => {
  stubs.loading = false;
  stubs.users = [];
  stubs.photosWithMe = [];
  stubs.albumsWithMe = [];
  stubs.photosByMe = [];
  stubs.albumsByMe = [];
  stubs.albums = [album(7, "Porto 2025")];
  stubs.shares = [share("abc", DateTime.now().minus({ days: 2 }).toISO())];
  stubs.publicPhotos = publicPage(2, [photo("p1", "2024-03-01T10:00:00Z"), photo("p2", null)]);
  stubs.publicPhotosPageSize = undefined;
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

async function render() {
  const Page = defined(stubs.component, "the Sharing overview");
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    defined(root).render(
      <MantineProvider env="test">
        <Page />
      </MantineProvider>
    )
  );
}

/** The section under the heading `title`. */
function sectionOf(title: string): HTMLElement {
  const heading = Array.from(document.body.querySelectorAll("h4")).find(h => h.textContent === title);
  return defined(defined(heading, `the ${title} heading`).closest("a")?.parentElement?.parentElement);
}

/** The cards of a section, in order: every link in it but the heading's. */
function cardsOf(title: string): HTMLAnchorElement[] {
  return Array.from(sectionOf(title).querySelectorAll("a")).filter(link => !link.querySelector("h4"));
}

const publicLinkCards = () => cardsOf("Public Links");

/** A card's caption lines, without the cover. */
const captionOf = (card: HTMLElement) => Array.from(card.querySelectorAll("p"), line => line.textContent);

describe("the Sharing overview's Public Links row (#2241)", () => {
  it("gives a photo share link card the 'Share link' caption and its age", async () => {
    await render();

    const cards = publicLinkCards();
    expect(cards).toHaveLength(4);
    expect(captionOf(defined(cards[1]))).toEqual(["Share link", "2 days ago"]);
  });

  it("gives a public photo card the 'Public photo' caption and the day it was taken", async () => {
    await render();

    const [, , dated, undated] = publicLinkCards();
    expect(captionOf(defined(dated))).toEqual(["Public photo", "Mar 1, 2024"]);
    // No date: still two lines, so the card keeps the row's height
    expect(captionOf(defined(undated))).toEqual(["Public photo", "\u00a0"]);
  });

  it("keeps the album card's title and photo count", async () => {
    await render();

    expect(captionOf(defined(publicLinkCards()[0]))).toEqual(["Porto 2025", "4 Photos"]);
  });

  it("gives every card in the row a caption", async () => {
    stubs.shares = [share("abc", "2026-01-01T00:00:00Z"), share("def", "2026-02-01T00:00:00Z")];
    await render();

    const captions = publicLinkCards().map(captionOf);
    expect(captions).toHaveLength(5);
    for (const caption of captions) expect(caption).toHaveLength(2);
  });

  it("shows the latest public photos and counts every one, not only those on the first page (#2686)", async () => {
    stubs.publicPhotos = publicPage(9, [photo("p1", "2024-03-01T10:00:00Z"), photo("p2", null)]);
    await render();

    // Asks the server for one row's worth
    expect(stubs.publicPhotosPageSize).toBe(6);
    const publicPhotoCards = publicLinkCards().filter(card => captionOf(card)[0] === "Public photo");
    expect(publicPhotoCards).toHaveLength(2);
    // 9 public photos and 1 share link; 1 public album
    expect(sectionOf("Public Links").textContent).toContain("10 photos, 1 album");
  });

  it("counts public photos alone as public links", async () => {
    stubs.albums = [];
    stubs.shares = [];
    stubs.publicPhotos = publicPage(3, [photo("p1", null)]);
    await render();

    expect(sectionOf("Public Links").textContent).toContain("3 photos, 0 albums");
    expect(document.body.textContent).not.toContain("You haven't made anything public via link yet");
  });

  it("opens the share dialog of a public album from its card", async () => {
    await render();
    const button = sectionOf("Public Links").querySelector<HTMLButtonElement>('button[aria-label="Sharing"]');
    await act(async () => defined(button, "the share button").click());

    expect(document.body.querySelector('[data-testid="share-dialog"]')?.textContent).toBe("7 of anna");
  });
});

describe("the Sharing overview's other sections", () => {
  it("previews what was shared with you and by you, counting each photo once", async () => {
    stubs.photosWithMe = [{ userId: 2, photos: [photo("w1", null)] }];
    stubs.albumsWithMe = [{ user_id: 2, albums: [{ ...album(9, "Lisbon with Mara"), public: false }] }];
    // One photo shared with two users: two groups, one photo
    stubs.photosByMe = [
      { userId: 2, photos: [photo("b1", null)] },
      { userId: 3, photos: [photo("b1", null)] },
    ];
    await render();

    expect(cardsOf("Shared with you").map(card => card.getAttribute("href"))).toEqual([
      "/sharing/withme/$tab",
      "/album/user/$id",
    ]);
    expect(sectionOf("Shared with you").textContent).toContain("1 photo, 1 album");
    expect(sectionOf("You shared").textContent).toContain("1 photo, 0 albums");
    expect(cardsOf("You shared").map(card => card.getAttribute("href"))).toEqual([
      "/sharing/byme/$tab",
      "/sharing/byme/$tab",
    ]);
  });

  it("says when nothing is shared or public", async () => {
    stubs.albums = [];
    stubs.shares = [];
    stubs.publicPhotos = publicPage(0, []);
    await render();

    const text = document.body.textContent;
    expect(text).toContain("No one has shared anything with you yet");
    expect(text).toContain("You haven't made anything public via link yet");
    expect(sectionOf("Public photos").textContent).toContain("0 users");
  });

  it("shows placeholders, not empty notes, while loading", async () => {
    stubs.loading = true;
    await render();

    expect(document.body.textContent).not.toContain("No one has shared anything with you yet");
    expect(publicLinkCards()).toEqual([]);
  });

  it("lists the users who share publicly", async () => {
    stubs.users = [user(2, "mara", true, "Mara", "Lopes"), user(3, "tom", true), user(4, "hidden", false)];
    await render();

    expect(cardsOf("Public photos").map(card => card.textContent)).toEqual(["Mara Lopes", "tom"]);
  });
});
