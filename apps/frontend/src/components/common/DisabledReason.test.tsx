/**
 * DisabledReason (#2237): a disabled control that says why. A `disabled` button fires no mouse or
 * focus events, so a Tooltip around it never opened and the reason it held was lost.
 */
import { ActionIcon, Button, MantineProvider, Menu } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { defined } from "../../util/defined.test-utils";
import { DisabledReason } from "./DisabledReason";
import {
  expectDisabledWithReason,
  focusAndReadTooltip,
  hover,
  hoverAndReadTooltip,
  tooltipText,
} from "./disabledReason.test-utils";

const onClick = vi.fn<() => void>();
const onSubmit = vi.fn<() => void>();
let root: Root | undefined;
let container: HTMLDivElement;

beforeAll(() => {
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
});

beforeEach(() => {
  onClick.mockReset();
  onSubmit.mockReset();
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  container.remove();
});

async function render(node: React.ReactNode, env: "default" | "test" = "default") {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(<MantineProvider env={env}>{node}</MantineProvider>);
  });
  return defined(container.querySelector("button"), "the control");
}

describe("DisabledReason", () => {
  it("marks the control disabled for assistive technology and describes it with the reason", async () => {
    const button = await render(
      <DisabledReason reason="A job is running">
        <Button onClick={onClick}>Scan</Button>
      </DisabledReason>
    );

    expectDisabledWithReason(button, "A job is running");
    expect(button.hasAttribute("data-disabled")).toBe(true);
  });

  it("shows the reason on hover", async () => {
    const button = await render(
      <DisabledReason reason="A job is running">
        <Button onClick={onClick}>Scan</Button>
      </DisabledReason>
    );

    expect(await hoverAndReadTooltip(button)).toContain("A job is running");
  });

  it("shows the reason on keyboard focus", async () => {
    const button = await render(
      <DisabledReason reason="A job is running">
        <Button onClick={onClick}>Scan</Button>
      </DisabledReason>
    );

    expect(await focusAndReadTooltip(button)).toContain("A job is running");
    expect(document.activeElement).toBe(button);
  });

  it("shows an icon button's own label above the reason", async () => {
    const button = await render(
      <DisabledReason label="Delete the faces" reason="Select at least one face first">
        <ActionIcon aria-label="Delete the faces" onClick={onClick}>
          x
        </ActionIcon>
      </DisabledReason>
    );

    const text = await focusAndReadTooltip(button);
    expect(text).toContain("Delete the faces");
    expect(text).toContain("Select at least one face first");
  });

  it("ignores clicks and keeps them from submitting a form", async () => {
    const button = await render(
      <form
        onSubmit={event => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <DisabledReason reason="A job is running">
          <Button type="submit" onClick={onClick}>
            Scan
          </Button>
        </DisabledReason>
      </form>
    );

    await act(async () => {
      button.click();
    });

    expect(onClick).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("leaves the control alone without a reason", async () => {
    const button = await render(
      <DisabledReason reason={false}>
        <Button onClick={onClick}>Scan</Button>
      </DisabledReason>
    );

    await act(async () => {
      button.click();
    });

    expect(onClick).toHaveBeenCalledOnce();
    expect(button.hasAttribute("aria-disabled")).toBe(false);
    expect(button.hasAttribute("aria-describedby")).toBe(false);
    await hover(button);
    expect(tooltipText()).toBe("");
  });

  it("keeps an enabled control's own label as its tooltip", async () => {
    const button = await render(
      <DisabledReason label="Delete the faces">
        <ActionIcon aria-label="Delete the faces" onClick={onClick}>
          x
        </ActionIcon>
      </DisabledReason>
    );

    expect(await hoverAndReadTooltip(button)).toContain("Delete the faces");
    expect(tooltipText()).not.toContain("first");
  });
});

/** Presses a key on the focused element, as a keyboard would (React listens for the native event). */
async function press(key: string) {
  await act(async () => {
    const target = document.activeElement ?? document.body;
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    // A button runs its click on Enter, which jsdom does not do.
    if (key === "Enter" && target instanceof HTMLElement) target.click();
  });
}

function menuItem(name: string): HTMLElement {
  const item = Array.from(document.querySelectorAll<HTMLElement>("[role='menuitem']")).find(el =>
    el.textContent?.includes(name)
  );
  return defined(item, `the "${name}" menu item`);
}

describe("DisabledReason on a menu item", () => {
  // Mantine's arrow-key navigation skips items marked `data-disabled`, so a keyboard user never
  // reached the item and never heard why it is off.
  async function renderMenu() {
    await render(
      <Menu defaultOpened transitionProps={{ duration: 0 }}>
        <Menu.Target>
          <Button>Actions</Button>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item>Add to album</Menu.Item>
          <DisabledReason reason="Select a single photo to use it as the cover" position="left">
            <Menu.Item onClick={onClick}>Set as album cover</Menu.Item>
          </DisabledReason>
          <Menu.Item>Share</Menu.Item>
        </Menu.Dropdown>
      </Menu>,
      // jsdom lays nothing out, so Popover would hide the dropdown as detached from its target.
      "test"
    );
  }

  it("is reached with the arrow keys and says why it is disabled", async () => {
    await renderMenu();
    await act(async () => {
      menuItem("Add to album").focus();
    });

    await press("ArrowDown");

    const item = menuItem("Set as album cover");
    expect(document.activeElement).toBe(item);
    expectDisabledWithReason(item, "Select a single photo to use it as the cover");
    expect(await focusAndReadTooltip(item)).toContain("Select a single photo to use it as the cover");

    await press("ArrowDown");
    expect(document.activeElement).toBe(menuItem("Share"));
  });

  it("does nothing and keeps the menu open when activated", async () => {
    await renderMenu();
    await act(async () => {
      menuItem("Set as album cover").focus();
    });

    await press("Enter");

    expect(onClick).not.toHaveBeenCalled();
    expect(menuItem("Set as album cover")).toBeTruthy();
  });
});

describe("DisabledReason on a menu's button", () => {
  // Around Menu.Target, not inside it: Menu.Target hands its props to the button, so the reason's
  // click handler replaces the one that opens the menu (#2621).
  async function renderMenuButton(reason: string | false) {
    return render(
      <Menu transitionProps={{ duration: 0 }}>
        <DisabledReason reason={reason}>
          <Menu.Target>
            <ActionIcon aria-label="Add to">+</ActionIcon>
          </Menu.Target>
        </DisabledReason>
        <Menu.Dropdown>
          <Menu.Item onClick={onClick}>Album</Menu.Item>
        </Menu.Dropdown>
      </Menu>,
      "test"
    );
  }

  it("says why and keeps the menu shut, by mouse and by keyboard", async () => {
    const button = await renderMenuButton("Select photos first");

    expectDisabledWithReason(button, "Select photos first");
    expect(button.hasAttribute("data-disabled")).toBe(true);
    expect(await focusAndReadTooltip(button)).toContain("Select photos first");
    await act(async () => {
      button.click();
    });
    await press("Enter");
    await press("ArrowDown");

    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector("[role='menuitem']")).toBeNull();
  });

  it("opens the menu without a reason", async () => {
    const button = await renderMenuButton(false);

    await act(async () => {
      button.click();
    });

    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(menuItem("Album")).toBeTruthy();
  });
});
