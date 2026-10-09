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
  hideNotification: vi.fn(),
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
  await act(async () => {
    root.render(
      <MantineProvider env="test">
        <CategorySection photoDetail={photo as any} />
      </MantineProvider>
    );
  });
  return container;
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
    expect(request).toEqual({ image_hashes: ["abc"], category: "photo", category_source: "user", notify: false });
    // Shown at once, before the photo detail refetches.
    expect(container.textContent).toContain("Set by you");
    expect(container.textContent).toContain("Shown in your timeline.");

    await act(async () => {
      callbacks.onSuccess();
    });
    expect(stubs.showNotification).toHaveBeenCalledTimes(1);

    // Undo restores the detected category and its automatic source.
    const message = stubs.showNotification.mock.calls[0][0].message;
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
    expect(stubs.mutate).toHaveBeenLastCalledWith(
      { image_hashes: ["abc"], category: "screenshot", category_source: "auto", notify: false },
      expect.anything()
    );
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
