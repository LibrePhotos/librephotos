/**
 * The comments and likes of a photo in a shared album (#262): comments show as plain text, never
 * markup; Enter sends; the heart is a toggle; with comments off there is no composer; and outside
 * a user album the section is not there at all.
 */
import type { AlbumComment, AlbumLikes } from "@librephotos/api-client";
import React, { act } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { click, renderInMantine, setUpMantineDom } from "../modals/confirmModal.test-utils";
import { AlbumThreadContext } from "./albumThread";
import { AlbumThreadSection } from "./AlbumThreadSection";

type Mutate<V> = (variables: V, options?: { onSuccess?: () => void }) => void;

const ben = { id: 9, username: "ben", first_name: "Ben", last_name: "Okafor" };
const stubs = vi.hoisted(() => ({
  comments: [] as AlbumComment[],
  likes: { count: 0, liked_by_me: false, users: [] } as AlbumLikes,
  commentsEnabled: true,
  add: vi.fn<Mutate<string>>(),
  like: vi.fn<(liked: boolean) => void>(),
}));

vi.mock("../../api_client/photos/hooks", () => ({
  useFetchPhotoDetailsQuery: () => ({ data: { id: "11111111-1111-1111-1111-111111111111" } }),
}));
vi.mock("../../api_client/albums/hooks", () => ({
  useAlbumPhotoCommentsQuery: () => ({ data: stubs.comments, isError: false }),
  useAlbumPhotoLikesQuery: () => ({ data: stubs.likes }),
  useFetchUserAlbumQuery: () => ({ data: { comments_enabled: stubs.commentsEnabled } }),
  useAlbumCommentMutations: () => ({
    add: { mutate: stubs.add, isPending: false },
    edit: { mutate: vi.fn<Mutate<{ commentId: number; text: string }>>(), isPending: false },
    remove: { mutate: vi.fn<Mutate<number>>(), isPending: false },
  }),
  useSetAlbumPhotoLikedMutation: () => ({ mutate: stubs.like, isPending: false }),
}));

const comment = (id: number, text: string): AlbumComment => ({
  id,
  author: ben,
  text,
  created_at: "2026-10-22T10:00:00Z",
  edited_at: null,
  can_edit: false,
  can_delete: false,
});

beforeAll(async () => {
  setUpMantineDom();
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  document.body.innerHTML = "";
  stubs.comments = [];
  stubs.likes = { count: 0, liked_by_me: false, users: [] };
  stubs.commentsEnabled = true;
  stubs.add.mockReset();
  stubs.like.mockReset();
});

async function renderThread(albumId: string | undefined) {
  await renderInMantine(
    <AlbumThreadContext.Provider value={albumId}>
      <AlbumThreadSection photoKey="p1" />
    </AlbumThreadContext.Provider>
  );
}

describe("AlbumThreadSection", () => {
  it("is not there outside a user album", async () => {
    await renderThread(undefined);
    expect(document.body.textContent).not.toContain("Comments");
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("shows a comment's markup as text", async () => {
    stubs.comments = [comment(1, '<img src=x onerror="alert(1)"><b>bold</b>')];
    await renderThread("4");

    expect(document.body.textContent).toContain('<img src=x onerror="alert(1)"><b>bold</b>');
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector("b")).toBeNull();
    expect(document.body.textContent).toContain("Ben Okafor");
  });

  it("sends a comment with Enter", async () => {
    await renderThread("4");
    const box = defined(document.querySelector("textarea"), "the composer");
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    await act(async () => {
      setValue?.call(box, "Good boy");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });

    expect(stubs.add).toHaveBeenCalledWith("Good boy", expect.anything());
  });

  it("toggles the heart and names who liked it", async () => {
    stubs.likes = { count: 1, liked_by_me: false, users: [ben] };
    await renderThread("4");
    const heart = defined(document.querySelector<HTMLButtonElement>('button[aria-pressed="false"]'), "the heart");
    expect(heart.getAttribute("aria-label")).toBe("Like, 1 so far");
    expect(document.body.textContent).toContain("Liked by Ben Okafor");

    await click(heart);

    expect(stubs.like).toHaveBeenCalledWith(true);
  });

  it("has no composer while the owner has comments off", async () => {
    stubs.commentsEnabled = false;
    await renderThread("4");

    expect(document.querySelector("textarea")).toBeNull();
    expect(document.querySelector("button[aria-pressed]")).toBeNull();
    expect(document.body.textContent).toContain("The album's owner turned comments off.");
  });
});
