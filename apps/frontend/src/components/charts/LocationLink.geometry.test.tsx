/**
 * The place tree draws what it drew with @visx/hierarchy and @visx/shape: for each layout, direction
 * and connection style the toolbar offers, the same node places and link paths, at a narrow and a
 * wide size. The fixture was captured from the visx version by this same walk through the toolbar.
 */
import React, { act } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { renderInMantine, setUpMantineDom } from "../modals/confirmModal.test-utils";
import { LocationLink } from "./LocationLink";
import styles from "./LocationLink.module.css";
import { PLACE_TREE_FIXTURE } from "./placeTreeFixture.test-utils";
import visx from "./placeTreeVisx.fixture.json";

vi.mock("../../api_client/stats/hooks", () => ({
  useFetchLocationTreeQuery: () => ({ data: PLACE_TREE_FIXTURE, isLoading: false }),
}));
vi.mock("../common/useListFailure", () => ({ useListFailure: () => null }));

type Drawn = { origin: string | null | undefined; links: (string | null)[]; nodes: (string | null | undefined)[][] };

const button = (name: string) =>
  defined(document.body.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`), name);

async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

/** A path without whitespace: visx wrote the radial step's path on several indented lines. */
const compact = (d: string | null | undefined) => (d ?? "").replace(/\s+/g, "");

/** Walks the toolbar through every layout the user can pick and records what the tree draws. */
async function drawEveryLayout(width: number) {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, width, 700));
  await renderInMantine(<LocationLink height={700} />);
  const bavaria = defined(
    [...document.body.querySelectorAll(`.${defined(styles.nodeGroup)}`)].find(g => g.textContent?.includes("Bavaria"))
  );
  await click(bavaria);
  const drawn: Record<string, Drawn> = {};
  for (const layout of ["Tree", "Radial"]) {
    await click(button(layout));
    for (const orientation of layout === "Tree" ? ["Horizontal", "Vertical"] : ["-"]) {
      if (orientation !== "-") await click(button(orientation));
      for (const link of ["Smooth", "Step", "Line"]) {
        await click(button(link));
        const svg = defined(document.body.querySelector("svg[aria-label]"));
        drawn[`${layout}/${orientation}/${link}`] = {
          origin: svg.querySelector("svg > g > g")?.getAttribute("transform"),
          links: [...svg.querySelectorAll("path")].map(p => p.getAttribute("d")),
          nodes: [...svg.querySelectorAll(`.${defined(styles.nodeGroup)}`)].map(g => [
            g.getAttribute("transform"),
            g.querySelector("rect")?.getAttribute("width"),
            g.textContent,
          ]),
        };
      }
    }
  }
  return drawn;
}

beforeAll(async () => {
  setUpMantineDom();
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe.each(["400", "1200"] as const)("the place tree at %spx wide", width => {
  it("places the nodes and draws the links as visx did, in every layout the toolbar offers", async () => {
    const expected: Record<string, Drawn> = visx[width];
    const drawn = await drawEveryLayout(Number(width));

    expect(Object.keys(drawn)).toEqual(Object.keys(expected));
    for (const [variant, want] of Object.entries(expected)) {
      const got = defined(drawn[variant]);
      expect(got.origin, variant).toBe(want.origin);
      expect(got.nodes, variant).toEqual(want.nodes);
      expect(got.links.length, variant).toBe(want.links.length);
      // The same characters but visx's line breaks: not even floating-point noise.
      expect(got.links.map(compact), variant).toEqual(want.links.map(compact));
    }
  });
});
