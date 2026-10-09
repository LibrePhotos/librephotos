/**
 * The lightbox's Category control (issue #2130): Photo / Screenshot / Document,
 * who set it, where the item shows up, an Undo, and owner-only.
 */
import "@mantine/core/styles.css";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { CategorySection } from "./CategorySection";

const stubs = vi.hoisted(() => ({
  mutate: vi.fn(),
  showNotification: vi.fn(),
  hideNotification: vi.fn(),
  userId: 1 as number | null,
  user: { id: 1, favorite_min_rating: 4, default_timeline_filter: { hide_screenshots: true } } as any,
}));

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
  // @ts-ignore - jsdom has no matchMedia, MantineProvider needs it
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
  // @ts-ignore - jsdom has no ResizeObserver, SegmentedControl needs it
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  // @ts-ignore
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

const screenshot = {
  image_hash: "abc",
  owner: { id: 1, username: "alice", first_name: "", last_name: "" },
  video: false,
  rating: 0,
  hidden: false,
  is_screenshot: true,
  is_document: false,
  category_source: "auto",
};

async function renderSection(photo: Record<string, unknown> = screenshot) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const rerender = async (next: Record<string, unknown>) => {
    await act(async () => {
      root.render(
        <MantineProvider env="test">
          <CategorySection photoDetail={next as any} />
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
    Array.from(toast.querySelectorAll("button"))
      .find(button => button.textContent === "Undo")!
      .click();
  });
}

function radio(container: HTMLElement, label: string) {
  const input = Array.from(container.querySelectorAll<HTMLInputElement>("input[type=radio]")).find(
    candidate => candidate.value === label
  );
  if (!input) throw new Error(`no option ${label}`);
  return input;
}

describe("CategorySection", () => {
  it("shows the detected category and where the item appears", async () => {
    const container = await renderSection();
    expect(radio(container, "screenshot").checked).toBe(true);
    expect(container.textContent).toContain("Detected automatically");
    expect(container.textContent).toContain("Shown in Screenshots. Hidden from your timeline by your filter.");
    expect(container.textContent).toContain("Your choice is kept");
  });

  it("marks the photo with the user's choice and offers an undo", async () => {
    const container = await renderSection();
    await act(async () => {
      radio(container, "photo").click();
    });
    expect(stubs.mutate).toHaveBeenCalledTimes(1);
    const [request, callbacks] = stubs.mutate.mock.calls[0];
    expect(request).toEqual({ image_hashes: ["abc"], category: "photo", notify: false });
    // Shown at once, before the photo detail refetches.
    expect(container.textContent).toContain("Set by you");
    expect(container.textContent).toContain("Shown in your timeline.");

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
    expect(container.textContent).toContain("Detected automatically");
  });

  it("undoes to the user's earlier choice when there was one", async () => {
    const container = await renderSection({ ...screenshot, category_source: "user" });
    await act(async () => {
      radio(container, "document").click();
    });
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
    await act(async () => {
      radio(container, "document").click();
    });
    await act(async () => {
      stubs.mutate.mock.calls[0][1].onSuccess();
    });
    const photoB = { ...screenshot, image_hash: "def", is_screenshot: false, category_source: "user" };
    await container.rerender(photoB);
    expect(radio(container, "photo").checked).toBe(true);

    await clickUndo(0);
    expect(stubs.mutate).toHaveBeenLastCalledWith(
      { image_hashes: ["abc"], category: "auto", notify: false },
      expect.anything()
    );
    expect(radio(container, "photo").checked).toBe(true);
    expect(container.textContent).toContain("Set by you");
  });

  it("replaces the previous toast instead of stacking Undo buttons", async () => {
    const container = await renderSection();
    await act(async () => {
      radio(container, "photo").click();
    });
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
    expect(radio(container, "screenshot").checked).toBe(true);
    expect(container.textContent).toContain("Shown in Screenshots. Hidden from your timeline by your filter.");
  });

  it("is not offered for a video, unless it carries a wrong flag to clear", async () => {
    const plainVideo = await renderSection({ ...screenshot, is_screenshot: false, video: true });
    expect(plainVideo.querySelector("input[type=radio]")).toBeNull();

    // A screen recording detected as a screenshot: only Photo is offered.
    const flagged = await renderSection({ ...screenshot, video: true });
    expect(radio(flagged, "screenshot").checked).toBe(true);
    expect(radio(flagged, "photo").disabled).toBe(false);
    expect(radio(flagged, "document").disabled).toBe(true);
  });

  it("says a trashed item is not in the timeline", async () => {
    const container = await renderSection({ ...screenshot, in_trashcan: true });
    expect(container.textContent).toContain("Items in the trash are not shown in your timeline.");
  });

  it("says when the item is in the timeline", async () => {
    const container = await renderSection({ ...screenshot, is_screenshot: false, category_source: "user" });
    expect(radio(container, "photo").checked).toBe(true);
    expect(container.textContent).toContain("Set by you");
    expect(container.textContent).toContain("Shown in your timeline.");
  });

  it("is not offered on someone else's photo", async () => {
    stubs.userId = 2;
    const container = await renderSection();
    expect(container.querySelector("input[type=radio]")).toBeNull();
    expect(container.textContent).not.toContain("Category");
  });
});
