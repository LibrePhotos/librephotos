/**
 * Repro for #2236: the faces tabs' counters came from their own `/faces/incomplete/` requests with
 * fixed parameters (date order, clustering, no confidence threshold), so they disagreed with the
 * lists the page shows as soon as the user picked classification or a threshold, and every page
 * load sent up to two extra full-list requests. The counters must be the page's own lists.
 */
import { UNKNOWN_PERSON_NAME } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompletePersonFace } from "../../api_client/faces/types";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import type { FacesTabLists } from "./facesCounters";
import { TabComponent } from "./TabComponent";

const stubs = vi.hoisted(() => ({
  get: vi.fn<(endpoint: string, config?: unknown) => Promise<unknown>>(),
}));

vi.mock("@tanstack/react-router", () => ({
  getRouteApi: () => ({ useSearch: () => ({ tab: "inferred" }) }),
  useNavigate: () => () => {},
}));
vi.mock("../../api_client/api", () => ({
  apiClient: { get: stubs.get },
  queryClient: new QueryClient(),
}));

/** A group as the page's list holds it: one placeholder per face. */
function group(id: number, name: string, faceCount: number): CompletePersonFace {
  return {
    id,
    name,
    kind: "USER",
    face_count: faceCount,
    faces: Array.from({ length: faceCount }, (unused, idx) => ({
      id: idx,
      image: null,
      face_url: null,
      photo: "",
      person_label_probability: 1,
      person: id,
      isTemp: true,
    })),
  };
}

// The page with classification and a confidence threshold: what the user sees on each tab.
const LISTS: FacesTabLists = {
  labeled: [group(1, "Alice", 300), group(2, "Bob", 10)],
  inferred: [group(1, "Alice", 30), group(2, "Bob", 8), group(3, "Carol", 3)],
  unknown: [group(4, UNKNOWN_PERSON_NAME, 25)],
};

let root: Root | undefined;
let container: HTMLDivElement;

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
  stubs.get.mockReset();
  // What the server answers an unfiltered clustering request: more groups than the page shows.
  stubs.get.mockResolvedValue(
    Array.from({ length: 9 }, (unused, idx) => ({ id: idx + 10, name: `P${idx}`, kind: "USER", face_count: 50 }))
  );
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  container.remove();
  vi.useRealTimers();
});

async function renderTabs() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <MantineProvider>
        <QueryClientProvider client={queryClient}>
          <TabComponent fetchingLabeledFacesList={false} fetchingInferredFacesList={false} lists={LISTS} />
        </QueryClientProvider>
      </MantineProvider>
    );
  });
}

function tab(name: string) {
  return defined(
    Array.from(container.querySelectorAll<HTMLElement>("[role=tab]")).find(el => el.textContent?.startsWith(name)),
    `${name} tab`
  );
}

/** Hovers a tab and returns the text of the hover card that opens. */
async function hover(name: string) {
  vi.useFakeTimers();
  await act(async () => {
    // floating-ui's hover listens for the native mouseenter on the target.
    tab(name).dispatchEvent(new MouseEvent("mouseenter"));
    await vi.advanceTimersByTimeAsync(1000);
  });
  // The open state mounts the dropdown on the next frames (its transition).
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
  vi.useRealTimers();
  return Array.from(document.querySelectorAll(".mantine-HoverCard-dropdown"))
    .map(el => el.textContent ?? "")
    .join("|");
}

describe("faces tabs' counters (#2236)", () => {
  it("sends no list request of its own: the page already has the lists", async () => {
    await renderTabs();
    expect(stubs.get).not.toHaveBeenCalled();
  });

  it("shows each tab's face count, the same faces the tab's grid shows", async () => {
    await renderTabs();
    expect(tab("Inferred").textContent).toContain("41");
    expect(tab("Unknown").textContent).toContain("25");
    expect(tab("Labeled").textContent).toContain("310");
  });

  it("counts the inferred tab's hover card from the page's list, the unknown group apart", async () => {
    await renderTabs();
    const text = await hover("Inferred");
    expect(text).toContain("3 Inferred persons (41 faces)");
    expect(text).toContain("4 Clusters (66 faces)");
  });

  it("counts labeled people without the unknown group", async () => {
    await renderTabs();
    expect(await hover("Labeled")).toContain("2 Persons (310 faces)");
  });

  it("counts the unknown faces", async () => {
    await renderTabs();
    expect(await hover("Unknown")).toContain("25 Unknown Faces");
  });
});
