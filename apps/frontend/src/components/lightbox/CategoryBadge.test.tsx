/**
 * The lightbox's Category badge (issue #2130): Photo / Screenshot / Document
 * from its menu, who set it, where the item shows up, an Undo, and owner-only.
 */
import "@mantine/core/styles.css";
import { MantineProvider } from "@mantine/core";
import type { NotificationData } from "@mantine/notifications";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SetPhotosCategoryRequest } from "../../api_client/photos/hooks/useSetPhotosCategoryMutation";
import type { Photo } from "../../api_client/photos/types";
import type { User } from "../../api_client/user/types";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { CategoryBadge } from "./CategoryBadge";
import { makePhoto } from "./photoFixture.test-utils";

/** The part of the signed-in user the section reads. */
type UserStub = Pick<User, "id" | "favorite_min_rating" | "default_timeline_filter">;

const stubs = vi.hoisted(() => {
  const user: UserStub = { id: 1, favorite_min_rating: 4, default_timeline_filter: { hide_screenshots: true } };
  const state: { userId: number | null; user: UserStub } = { userId: 1, user };
  return Object.assign(state, {
    mutate: vi.fn<(request: SetPhotosCategoryRequest, options: { onSuccess: () => void }) => void>(),
    showNotification: vi.fn<(notification: NotificationData) => string>(),
    hideNotification: vi.fn<(id: string) => void>(),
  });
});

vi.mock("../../api_client/photos/hooks/useSetPhotosCategoryMutation", async importOriginal => ({
  ...(await importOriginal<typeof import("../../api_client/photos/hooks/useSetPhotosCategoryMutation")>()),
  useSetPhotosCategoryMutation: () => ({ mutate: stubs.mutate, isPending: false }),
}));
vi.mock("../../api_client/user/hooks/useCurrentUserSelfDetailsQuery", () => ({
  useCurrentUserSelfDetailsQuery: () => ({ data: stubs.user }),
}));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ userId: stubs.userId }) }));
vi.mock("@mantine/notifications", () => ({
  showNotification: stubs.showNotification,
  hideNotification: stubs.hideNotification,
}));

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
});

beforeEach(() => {
  document.body.innerHTML = "";
  stubs.mutate.mockReset();
  stubs.showNotification.mockReset();
  stubs.hideNotification.mockReset();
  stubs.user = { id: 1, favorite_min_rating: 4, default_timeline_filter: { hide_screenshots: true } };
  stubs.userId = 1;
});

const screenshot = makePhoto({
  image_hash: "abc",
  owner: { id: 1, username: "alice", first_name: "", last_name: "" },
  video: false,
  rating: 0,
  hidden: false,
  is_screenshot: true,
  is_document: false,
  category_source: "auto",
});

async function renderSection(photo: Photo = screenshot) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const rerender = async (next: Photo) => {
    await act(async () => {
      root.render(
        <MantineProvider env="test">
          <CategoryBadge photoDetail={next} />
        </MantineProvider>
      );
    });
  };
  await rerender(photo);
  return Object.assign(container, { rerender });
}

// Renders a toast's message the way Mantine would and clicks its Undo.
async function clickUndo(call: number) {
  const { message } = stubs.showNotification.mock.calls[call][0];
  const toast = document.createElement("div");
  document.body.appendChild(toast);
  await act(async () => {
    createRoot(toast).render(<MantineProvider env="test">{message}</MantineProvider>);
  });
  await act(async () => {
    defined(Array.from(toast.querySelectorAll("button")).find(button => button.textContent === "Undo")).click();
  });
}

function badge(container: HTMLElement) {
  return container.querySelector<HTMLButtonElement>('button[aria-label^="Category:"]');
}

/** Opens the badge's menu (if it is not open yet); returns the dropdown's text. */
async function openMenu(container: HTMLElement) {
  if (!document.querySelector("[role=menu]")) {
    await act(async () => {
      defined(badge(container)).click();
    });
  }
  return defined(document.querySelector("[role=menu]")).textContent;
}

async function item(container: HTMLElement, label: string) {
  await openMenu(container);
  const found = Array.from(document.querySelectorAll<HTMLButtonElement>("[role=menuitem]")).find(
    candidate => candidate.textContent === label
  );
  if (!found) throw new Error(`no option ${label}`);
  return found;
}

async function pick(container: HTMLElement, label: string) {
  const option = await item(container, label);
  await act(async () => {
    option.click();
  });
}

async function current(container: HTMLElement) {
  await openMenu(container);
  return defined(document.querySelector("[role=menuitem][aria-current=true]")).textContent;
}

describe("CategoryBadge", () => {
  it("shows the detected category and where the item appears", async () => {
    const container = await renderSection();
    expect(badge(container)?.textContent).toBe("Screenshot");
    const menu = await openMenu(container);
    expect(await current(container)).toBe("Screenshot");
    expect(menu).toContain("Detected automatically");
    expect(menu).toContain("Shown in Screenshots. Hidden from your timeline by your filter.");
    expect(menu).toContain("Your choice is kept");
  });

  it("marks the photo with the user's choice and offers an undo", async () => {
    const container = await renderSection();
    await pick(container, "Photo");
    expect(stubs.mutate).toHaveBeenCalledTimes(1);
    const [request, callbacks] = stubs.mutate.mock.calls[0];
    expect(request).toEqual({ image_hashes: ["abc"], category: "photo", notify: false });
    // Shown at once, before the photo detail refetches.
    expect(badge(container)?.textContent).toBe("Photo");
    const menu = await openMenu(container);
    expect(menu).toContain("Set by you");
    expect(menu).toContain("Shown in your timeline.");

    await act(async () => {
      callbacks.onSuccess();
    });
    expect(stubs.showNotification).toHaveBeenCalledTimes(1);

    // The category was detected: Undo hands the photo back to the detectors.
    await clickUndo(0);
    expect(stubs.mutate).toHaveBeenLastCalledWith(
      { image_hashes: ["abc"], category: "auto", notify: false },
      expect.anything()
    );
    expect(badge(container)?.textContent).toBe("Screenshot");
    expect(await openMenu(container)).toContain("Detected automatically");
  });

  it("undoes to the user's earlier choice when there was one", async () => {
    const container = await renderSection({ ...screenshot, category_source: "user" });
    await pick(container, "Document");
    await act(async () => {
      stubs.mutate.mock.calls[0][1].onSuccess();
    });
    await clickUndo(0);
    expect(stubs.mutate).toHaveBeenLastCalledWith(
      { image_hashes: ["abc"], category: "screenshot", notify: false },
      expect.anything()
    );
  });

  it("keeps an Undo on the photo it came from after the lightbox moved on", async () => {
    // The same component instance moves from A to B, as an unkeyed Sidebar
    // child would; Undo in A's toast must still target A, and B must keep
    // showing its own category.
    const container = await renderSection();
    await pick(container, "Document");
    await act(async () => {
      stubs.mutate.mock.calls[0][1].onSuccess();
    });
    const photoB: Photo = { ...screenshot, image_hash: "def", is_screenshot: false, category_source: "user" };
    await container.rerender(photoB);
    expect(badge(container)?.textContent).toBe("Photo");

    await clickUndo(0);
    expect(stubs.mutate).toHaveBeenLastCalledWith(
      { image_hashes: ["abc"], category: "auto", notify: false },
      expect.anything()
    );
    expect(badge(container)?.textContent).toBe("Photo");
    expect(await openMenu(container)).toContain("Set by you");
  });

  it("replaces the previous toast instead of stacking Undo buttons", async () => {
    await pick(await renderSection(), "Photo");
    await act(async () => {
      stubs.mutate.mock.calls[0][1].onSuccess();
    });
    expect(stubs.hideNotification).toHaveBeenCalledWith("photo-category-undo");
    expect(stubs.showNotification.mock.calls[0][0].id).toBe("photo-category-undo");
  });

  it("says where it shows from the real flags, not the displayed category", async () => {
    // Flagged both: shown as Screenshot, but a saved "hide documents" hides
    // it too.
    stubs.user = { ...stubs.user, default_timeline_filter: { hide_documents: true } };
    const container = await renderSection({ ...screenshot, is_document: true });
    expect(badge(container)?.textContent).toBe("Screenshot");
    expect(await openMenu(container)).toContain("Shown in Screenshots. Hidden from your timeline by your filter.");
  });

  it("is not offered for a video, unless it carries a wrong flag to clear", async () => {
    const plainVideo = await renderSection({ ...screenshot, is_screenshot: false, video: true });
    expect(badge(plainVideo)).toBeNull();

    // A screen recording detected as a screenshot: only Photo is offered.
    const flagged = await renderSection({ ...screenshot, video: true });
    expect(await current(flagged)).toBe("Screenshot");
    expect((await item(flagged, "Photo")).disabled).toBe(false);
    expect((await item(flagged, "Document")).disabled).toBe(true);
  });

  it("says a trashed item is not in the timeline", async () => {
    const container = await renderSection({ ...screenshot, in_trashcan: true });
    expect(await openMenu(container)).toContain("Items in the trash are not shown in your timeline.");
  });

  it("says when the item is in the timeline", async () => {
    const container = await renderSection({ ...screenshot, is_screenshot: false, category_source: "user" });
    expect(badge(container)?.textContent).toBe("Photo");
    const menu = await openMenu(container);
    expect(menu).toContain("Set by you");
    expect(menu).toContain("Shown in your timeline.");
  });

  it("is not offered on someone else's photo", async () => {
    stubs.userId = 2;
    const container = await renderSection();
    expect(badge(container)).toBeNull();
    expect(container.textContent).not.toContain("Screenshot");
  });
});
