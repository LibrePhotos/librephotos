/**
 * The lightbox had a Tags and a Keywords section listing mostly the same words
 * (#2230). One Tags section is left, and a tag that came from the file's
 * keywords carries a file marker.
 */
import type { Tag } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { makePhoto } from "./photoFixture.test-utils";
import { TagsSection } from "./TagsSection";

const stubs = vi.hoisted(() => ({
  keywords: undefined as string[] | null | undefined,
  tags: [] as Tag[],
}));

vi.mock("../../api_client/photos/hooks", () => ({
  useFetchPhotoMetadataQuery: () => ({
    data: stubs.keywords === undefined ? undefined : { keywords: stubs.keywords },
  }),
}));
vi.mock("../../api_client/tags/hooks", () => ({
  useFetchPhotoTagsQuery: () => ({ data: stubs.tags }),
  useFetchTagsQuery: () => ({ data: stubs.tags }),
  useCreateTagMutation: () => ({ mutateAsync: vi.fn<() => Promise<Tag>>() }),
  useAddPhotosToTagMutation: () => ({ mutateAsync: vi.fn<() => Promise<void>>(), isPending: false }),
  useRemovePhotosFromTagMutation: () => ({ mutateAsync: vi.fn<() => Promise<void>>(), isPending: false }),
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn<(options: { to: string }) => void>() }));

beforeAll(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
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
  // jsdom has no ResizeObserver, the suggestion dropdown's scroll area needs it
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  await i18n.changeLanguage("en");
});

const mounted: Array<() => Promise<void>> = [];

beforeEach(() => {
  stubs.keywords = [];
  stubs.tags = [];
});

afterEach(async () => {
  while (mounted.length) await defined(mounted.pop())();
});

const tag = (id: number, name: string): Tag => ({ id, name, photo_count: 1 });
const markerLabel = () => i18n.t("lightbox.sidebar.tagFromFile");

async function renderTags(props: Partial<React.ComponentProps<typeof TagsSection>> = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MantineProvider env="test">
        <TagsSection photoDetail={makePhoto({ image_hash: "a" })} {...props} />
      </MantineProvider>
    );
  });
  mounted.push(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  return container;
}

/** The tag badges (view mode) by name, each with whether it carries the file marker. */
function badgeMarkers(container: HTMLElement) {
  return Object.fromEntries(
    Array.from(container.querySelectorAll<HTMLButtonElement>("button.mantine-Badge-root")).map(badge => [
      badge.textContent?.trim(),
      badge.querySelector(`[role="img"][aria-label="${markerLabel()}"]`) !== null,
    ])
  );
}

/** The editor's pills by name, each with whether it carries the file marker. */
function pillMarkers(container: HTMLElement) {
  return Object.fromEntries(
    Array.from(container.querySelectorAll<HTMLElement>(".mantine-Pill-root")).map(pill => [
      pill.textContent?.trim(),
      pill.querySelector(`[role="img"][aria-label="${markerLabel()}"]`) !== null,
    ])
  );
}

async function openEditor(container: HTMLElement) {
  const button = defined(
    container.querySelector<HTMLButtonElement>(`button[aria-label="${i18n.t("lightbox.sidebar.editTags")}"]`),
    "the edit button"
  );
  await act(async () => button.click());
}

describe("TagsSection", () => {
  it("marks a tag that came from the file's keywords, not one added by hand", async () => {
    stubs.tags = [tag(1, "family"), tag(2, "Beach")];
    // Matched case-insensitively and trimmed, as a scan names the tag.
    stubs.keywords = [" beach ", "Portugal"];

    const container = await renderTags();

    expect(badgeMarkers(container)).toEqual({ family: false, Beach: true });
  });

  it("shows no marker while the photo's keywords are still loading", async () => {
    stubs.tags = [tag(2, "beach")];
    stubs.keywords = undefined;

    const container = await renderTags();

    expect(badgeMarkers(container)).toEqual({ beach: false });
  });

  it("shows no marker when the photo has no keywords", async () => {
    stubs.tags = [tag(2, "beach")];
    stubs.keywords = null;

    const container = await renderTags();

    expect(badgeMarkers(container)).toEqual({ beach: false });
  });

  it("is the only tag list: there is no separate keywords editor", async () => {
    stubs.tags = [tag(2, "beach")];
    stubs.keywords = ["beach"];

    const container = await renderTags();

    expect(Array.from(container.querySelectorAll("h4")).map(h => h.textContent)).toEqual([
      i18n.t("lightbox.sidebar.tags"),
    ]);
    expect(container.querySelectorAll("button[aria-label]")).toHaveLength(1);
  });

  it("keeps the marker on file pills in the editor and explains it once", async () => {
    stubs.tags = [tag(1, "family"), tag(2, "beach")];
    stubs.keywords = ["Beach"];

    const container = await renderTags();
    await openEditor(container);

    expect(pillMarkers(container)).toEqual({ family: false, beach: true });
    expect(container.textContent).toContain(i18n.t("lightbox.sidebar.tagsFromFileHint"));
  });

  it("leaves the hint out when no tag in the editor came from the file", async () => {
    stubs.tags = [tag(1, "family")];
    stubs.keywords = ["beach"];

    const container = await renderTags();
    await openEditor(container);

    expect(pillMarkers(container)).toEqual({ family: false });
    expect(container.textContent).not.toContain(i18n.t("lightbox.sidebar.tagsFromFileHint"));
  });

  it("shows a card's heading in place of its own, next to the pencil", async () => {
    const container = await renderTags({ heading: <h2>Tags card</h2> });

    expect(container.querySelector("h2")?.textContent).toBe("Tags card");
    expect(container.querySelector("h4")).toBeNull();
    await openEditor(container);
    expect(container.querySelector("input")).not.toBeNull();
  });

  it("opens the editor at once when asked to", async () => {
    const container = await renderTags({ startEditing: true });

    expect(container.querySelector("input")).not.toBeNull();
    expect(container.querySelector(`button[aria-label="${i18n.t("lightbox.sidebar.save")}"]`)).not.toBeNull();
  });
});
