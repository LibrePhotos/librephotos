/**
 * Every menu fits the window and scrolls past it (#2707): the bulk-actions menu ran off the bottom of
 * the window and its last items could not be reached.
 */
import { createTheme, MantineProvider, Menu } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { setUpMantineDom } from "../components/modals/confirmModal.test-utils";
import { defined } from "../util/defined.test-utils";
import { capToWindow, menuThemeComponents } from "./menuTheme";

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
