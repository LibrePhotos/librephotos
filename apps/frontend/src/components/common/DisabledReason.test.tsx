/**
 * DisabledReason (#2237): a disabled control that says why. A `disabled` button fires no mouse or
 * focus events, so a Tooltip around it never opened and the reason it held was lost.
 */
import { ActionIcon, Button, MantineProvider } from "@mantine/core";
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

async function render(node: React.ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(<MantineProvider>{node}</MantineProvider>);
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
