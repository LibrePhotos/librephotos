/**
 * #2245: the place tree's layout, direction and connection toggles are named buttons that say which
 * one is chosen, and the tree follows them; the zoom buttons are named in the UI language.
 */
import React, { act } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { renderInMantine, setUpMantineDom } from "../modals/confirmModal.test-utils";
import { LocationLink } from "./LocationLink";
import styles from "./LocationLink.module.css";

const tree = {
  name: "Places",
  children: [
    {
      name: "Germany",
      value: 3,
      children: [
        { name: "Berlin", value: 2 },
        { name: "Hamburg", value: 1 },
      ],
    },
    { name: "Portugal", value: 1, children: [{ name: "Lisbon", value: 1 }] },
  ],
};

vi.mock("../../api_client/stats/hooks", () => ({
  useFetchLocationTreeQuery: () => ({ data: tree, isLoading: false }),
}));
vi.mock("../common/useListFailure", () => ({ useListFailure: () => null }));

const button = (name: string) =>
  defined(document.body.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`), name);
const pressed = (name: string) => button(name).getAttribute("aria-pressed");
const groupNames = () =>
  Array.from(document.body.querySelectorAll('[role="group"]'), group => group.getAttribute("aria-label"));
const nodes = () => document.body.querySelectorAll(`.${defined(styles.nodeGroup)}`);
const transform = () => defined(document.body.querySelector("svg > g")).getAttribute("transform");

async function press(element: Element, event: Event = new MouseEvent("click", { bubbles: true })) {
  await act(async () => {
    element.dispatchEvent(event);
  });
}

beforeAll(async () => {
  setUpMantineDom();
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("LocationLink toolbar", () => {
  it("names the toggles and marks the chosen layout, direction and connection style", async () => {
    await renderInMantine(<LocationLink />);

    expect(groupNames()).toEqual(["Layout", "Direction", "Connections"]);
    expect([pressed("Tree"), pressed("Radial")]).toEqual(["true", "false"]);
    expect([pressed("Horizontal"), pressed("Vertical")]).toEqual(["true", "false"]);
    expect([pressed("Smooth"), pressed("Step"), pressed("Line")]).toEqual(["false", "false", "true"]);
  });

  it("follows a pressed toggle", async () => {
    await renderInMantine(<LocationLink />);

    await press(button("Vertical"));
    await press(button("Step"));
    expect([pressed("Horizontal"), pressed("Vertical"), pressed("Step")]).toEqual(["false", "true", "true"]);

    await press(button("Radial"));
    expect([pressed("Tree"), pressed("Radial")]).toEqual(["false", "true"]);
    // The direction only applies to the tree layout
    expect(groupNames()).toEqual(["Layout", "Connections"]);
    await press(button("Smooth"));
    expect(pressed("Smooth")).toBe("true");
  });

  it("zooms with the named buttons and the keyboard (=), and resets", async () => {
    await renderInMantine(<LocationLink />);

    await press(button("Zoom in (+)"));
    expect(document.body.textContent).toContain("115%");
    await press(document.body, new KeyboardEvent("keydown", { key: "=", bubbles: true }));
    expect(document.body.textContent).toContain("130%");
    await press(button("Zoom out (-)"));
    expect(document.body.textContent).toContain("115%");
    await press(button("Reset view (0)"));
    expect(document.body.textContent).toContain("100%");
    expect(transform()).toBe("translate(0,0) scale(1)");
  });

  it("expands a place on click, pans with the mouse and zooms with the wheel", async () => {
    await renderInMantine(<LocationLink />);
    const hint = "Click nodes to expand";
    expect(document.body.textContent).toContain(hint);
    expect(nodes()).toHaveLength(1);

    await press(defined(nodes()[0]));
    expect(nodes()).toHaveLength(3);
    expect(document.body.textContent).not.toContain(hint);

    const svg = defined(document.body.querySelector("svg[aria-label]"));
    await press(svg, new MouseEvent("mousemove", { bubbles: true, buttons: 1, screenX: 10, screenY: 10 }));
    await press(svg, new WheelEvent("wheel", { bubbles: true, deltaY: -100 }));
    expect(transform()).toContain("scale(1.15)");
  });
});
