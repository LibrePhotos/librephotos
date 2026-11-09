/**
 * The People page's way to the face dashboard: the faces waiting, in the accent colour, or a quiet
 * "Review faces" when none wait. It never disappears, and it opens the tab that lists what it counts.
 */
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { FacesReviewLink } from "./FacesReviewLink";

type LinkProps = React.AnchorHTMLAttributes<HTMLAnchorElement> & { search?: unknown; to?: string };

const stubs = vi.hoisted(() => ({
  count: undefined as number | undefined,
  queryParams: [] as unknown[],
}));

vi.mock("@tanstack/react-router", () => ({
  // Like the router's Link: every other prop (the class, data-waiting) lands on the <a>
  Link: ({ search, to, ...props }: LinkProps) => <a {...props} href={to} data-search={JSON.stringify(search)} />,
}));
vi.mock("../../api_client/faces/hooks", () => ({
  useFacesReviewCountQuery: (params: unknown) => {
    stubs.queryParams.push(params);
    return { data: stubs.count };
  },
}));

let root: Root | undefined;
let container: HTMLDivElement;

beforeAll(() => {
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
});

afterEach(() => {
  act(() => root?.unmount());
  container.remove();
  stubs.queryParams.length = 0;
});

function render(count: number | undefined, group?: number) {
  stubs.count = count;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      <MantineProvider>
        <FacesReviewLink group={group} />
      </MantineProvider>
    )
  );
  return defined(container.querySelector("a"));
}

describe("FacesReviewLink", () => {
  it("counts the faces waiting, in the accent colour", () => {
    const link = render(25);
    expect(link.textContent).toBe("25 faces to review");
    expect(link.hasAttribute("data-waiting")).toBe(true);
  });

  it("says a backlog over 999 without the exact number", () => {
    expect(render(1500).textContent).toBe("999+ faces to review");
  });

  it("stays as a quiet link with nothing waiting or while the count loads", () => {
    for (const count of [0, undefined]) {
      const link = render(count);
      expect(link.textContent).toBe("Review faces");
      expect(link.hasAttribute("data-waiting")).toBe(false);
      act(() => root?.unmount());
      container.remove();
    }
    container = document.createElement("div");
  });

  it("opens the Suggested tab, narrowed to the group the page shows", () => {
    const link = render(3, 7);
    expect(link.getAttribute("href")).toBe("/faces");
    expect(JSON.parse(link.getAttribute("data-search") ?? "{}")).toMatchObject({ tab: "inferred", group: 7 });
    expect(stubs.queryParams[0]).toMatchObject({ method: "clustering", minConfidence: 0.7, group: 7 });
  });
});
