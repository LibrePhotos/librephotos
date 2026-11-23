import { MantineProvider } from "@mantine/core";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { setUpMantineDom } from "../modals/confirmModal.test-utils";
import { cameraRows } from "./cameraStatsView";
import { RankBarList, type RankRow } from "./RankBarList";

let root: Root;

async function render(rows: readonly RankRow[], limit = 12) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const router = createRouter({
    routeTree: createRootRoute({ component: () => <RankBarList rows={rows} limit={limit} /> }),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await act(async () => {
    root.render(
      <MantineProvider env="test">
        <RouterProvider router={router} />
      </MantineProvider>
    );
  });
}

const links = () => [...document.body.querySelectorAll<HTMLAnchorElement>("a")];
const query = (link: HTMLAnchorElement) => Object.fromEntries(new URL(link.href, "http://x").searchParams);
const toggle = () => defined(document.body.querySelector<HTMLButtonElement>("button[aria-expanded]"));

const rows: RankRow[] = Array.from({ length: 14 }, (_unused, index) => ({
  key: `lens-${index}`,
  label: `Lens ${index}`,
  count: 14 - index,
  search: { lens: `Lens ${index}` },
}));

beforeAll(async () => {
  setUpMantineDom();
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(async () => {
  await act(async () => root.unmount());
});

describe("RankBarList", () => {
  it("links each row to the search its count comes from", async () => {
    await render(
      cameraRows([
        { label: "Apple iPhone 15 Pro", value: "iPhone 15 Pro", make: "Apple", count: 3 },
        { label: "Dacia Phone", value: "Dacia Phone", make: "", count: 1 },
      ])
    );
    const [apple, dacia] = links();
    expect(new URL(defined(apple).href, "http://x").pathname).toBe("/search");
    expect(query(defined(apple))).toEqual({ camera: "iPhone 15 Pro", make: "Apple" });
    expect(query(defined(dacia))).toEqual({ camera: "Dacia Phone" });
    expect(defined(apple).textContent).toBe("Apple iPhone 15 Pro3 photos");
  });

  it("shows the first rows and every row on Show all", async () => {
    await render(rows);
    expect(links()).toHaveLength(12);
    expect(toggle().textContent).toBe("Show all (14)");
    expect(toggle().getAttribute("aria-expanded")).toBe("false");

    await act(async () => toggle().click());
    expect(links().map(link => link.textContent)).toContain("Lens 131 photo");
    expect(links()).toHaveLength(14);
    expect(toggle().textContent).toBe("Show fewer");

    await act(async () => toggle().click());
    expect(links()).toHaveLength(12);
  });

  it("offers no toggle when every row fits", async () => {
    await render(rows.slice(0, 12));
    expect(links()).toHaveLength(12);
    expect(document.body.querySelector("button[aria-expanded]")).toBeNull();
  });
});
