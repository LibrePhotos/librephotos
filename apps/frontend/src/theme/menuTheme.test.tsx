/**
 * Every menu fits the window and scrolls past it (#2707): the bulk-actions menu ran off the bottom of
 * the window and its last items could not be reached. On a phone it is an action sheet at the
 * bottom of the window instead (review s0 #1).
 */
import { createTheme, MantineProvider, Menu } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { setUpMantineDom } from "../components/modals/confirmModal.test-utils";
import { defined } from "../util/defined.test-utils";
import { capToWindow, fitWindow, menuThemeComponents, placeAsSheet } from "./menuTheme";

const theme = createTheme({ components: menuThemeComponents });

let root: Root | undefined;
let container: HTMLDivElement | undefined;

beforeAll(setUpMantineDom);

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

async function renderMenu(menu: React.ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  const created = createRoot(container);
  root = created;
  await act(async () => {
    created.render(<MantineProvider theme={theme}>{menu}</MantineProvider>);
  });
  // floating-ui positions on the next frame.
  await act(async () => {
    await new Promise(resolve => requestAnimationFrame(resolve));
  });
}

function dropdownOf(item: string): HTMLElement {
  const menuItem = [...document.querySelectorAll<HTMLElement>("[role='menuitem']")].find(
    element => element.textContent === item
  );
  return defined(defined(menuItem).closest<HTMLElement>("[role='menu']"));
}

describe("capToWindow", () => {
  function apply(availableHeight: number) {
    const floating = document.createElement("div");
    capToWindow({ availableHeight, elements: { floating } });
    return floating.style;
  }

  it("caps the dropdown at the room left in the window and lets it scroll", () => {
    const style = apply(312);
    expect(style.maxHeight).toBe("312px");
    expect(style.overflowY).toBe("auto");
  });

  it("never sets a negative height", () => {
    expect(apply(-20).maxHeight).toBe("0px");
  });
});

describe("placeAsSheet", () => {
  // Where floating-ui put the dropdown under its button, and the sheet's height in the window.
  function place(x: number, y: number, height: number) {
    const floating = document.createElement("div");
    Object.defineProperty(floating, "offsetHeight", { value: height });
    placeAsSheet({ x, y, elements: { floating } });
    return floating;
  }

  it("moves the dropdown to the window's bottom edge, the whole width of it", () => {
    const sheet = place(120, 64, 300);
    // left + margin-left is 0, top + margin-top the window's height less the sheet's
    expect(sheet.style.marginLeft).toBe("-120px");
    expect(sheet.style.marginTop).toBe(`${window.innerHeight - 64 - 300}px`);
    const width = `${document.documentElement.clientWidth}px`;
    expect(sheet.style.minWidth).toBe(width);
    expect(sheet.style.maxWidth).toBe(width);
    expect(sheet.dataset.sheet).toBe("true");
  });

  it("scrolls past 80 % of the window's height", () => {
    const sheet = place(0, 0, 100);
    expect(sheet.style.maxHeight).toBe(`${Math.round(window.innerHeight * 0.8)}px`);
    expect(sheet.style.overflowY).toBe("auto");
  });
});

describe("fitWindow", () => {
  function fit(phone: boolean, floating: HTMLElement) {
    const original = window.matchMedia;
    window.matchMedia = query => ({ ...original(query), matches: phone });
    try {
      fitWindow({ availableHeight: 400, x: 30, y: 50, elements: { floating } });
    } finally {
      window.matchMedia = original;
    }
  }

  it("turns the dropdown into a sheet on a phone, and back into a dropdown on a wider window", () => {
    const floating = document.createElement("div");
    fit(true, floating);
    expect(floating.dataset.sheet).toBe("true");

    fit(false, floating);
    expect(floating.dataset.sheet).toBeUndefined();
    expect(floating.style.marginTop).toBe("");
    expect(floating.style.minWidth).toBe("");
    expect(floating.style.maxHeight).toBe("400px");
  });
});

describe("menuThemeComponents", () => {
  it("makes a plain Menu's dropdown scroll inside the window", async () => {
    await renderMenu(
      <Menu defaultOpened>
        <Menu.Target>
          <button type="button">Open</button>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item>Move to trash</Menu.Item>
        </Menu.Dropdown>
      </Menu>
    );
    const dropdown = dropdownOf("Move to trash");
    expect(dropdown.style.overflowY).toBe("auto");
    expect(dropdown.style.maxHeight).toMatch(/^\d+(\.\d+)?px$/);
  });

  it("places a submenu against the window, so the scrolling parent does not clip it", async () => {
    await renderMenu(
      <Menu defaultOpened>
        <Menu.Target>
          <button type="button">Open</button>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Sub opened>
            <Menu.Sub.Target>
              <Menu.Sub.Item>Set rating</Menu.Sub.Item>
            </Menu.Sub.Target>
            <Menu.Sub.Dropdown>
              <Menu.Item>5 stars</Menu.Item>
            </Menu.Sub.Dropdown>
          </Menu.Sub>
        </Menu.Dropdown>
      </Menu>
    );
    const submenu = dropdownOf("5 stars");
    // Mantine's stylesheet turns `data-fixed` into `position: fixed`.
    expect(submenu.dataset.fixed).toBe("true");
    expect(submenu.style.overflowY).toBe("auto");
  });
});
