/**
 * The main timeline's Filter popover (issue #2130): toggling a switch hands the
 * new filter up, the button shows how many filters are active, and the footer
 * offers Reset / Save as default only when the view differs from the default.
 */
import "@mantine/core/styles.css";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { SHOW_EVERYTHING, type TimelineFilter } from "./timelineFilter";
import { TimelineFilterPopover } from "./TimelineFilterPopover";

const onChange = vi.fn();
const onReset = vi.fn();
const onSaveDefault = vi.fn();

beforeAll(async () => {
  // @ts-ignore - jsdom has no matchMedia, MantineProvider needs it
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
  // @ts-ignore - jsdom has no ResizeObserver, SegmentedControl needs it
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  // @ts-ignore
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  document.body.innerHTML = "";
  onChange.mockReset();
  onReset.mockReset();
  onSaveDefault.mockReset();
});

async function renderPopover(current: TimelineFilter, saved: TimelineFilter = SHOW_EVERYTHING, ready = true) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MantineProvider env="test">
        <TimelineFilterPopover
          current={current}
          saved={saved}
          onChange={onChange}
          onReset={onReset}
          onSaveDefault={onSaveDefault}
          ready={ready}
        />
      </MantineProvider>
    );
  });
  return container;
}

function buttonByText(text: string): HTMLButtonElement {
  const button = Array.from(document.body.querySelectorAll("button")).find(
    candidate => candidate.textContent?.trim() === text
  );
  if (!button) throw new Error(`no button "${text}"`);
  return button as HTMLButtonElement;
}

// The Filter button is the first button on the page.
async function open() {
  await act(async () => {
    document.body.querySelector("button")!.click();
  });
}

function switchLabelled(text: string): HTMLInputElement {
  const label = Array.from(document.body.querySelectorAll("label")).find(candidate =>
    candidate.textContent?.includes(text)
  );
  const input = label?.closest(".mantine-Switch-root")?.querySelector("input");
  if (!input) throw new Error(`no switch "${text}"`);
  return input as HTMLInputElement;
}

describe("TimelineFilterPopover", () => {
  it("shows no badge while nothing filters, and the count once something does", async () => {
    const plain = await renderPopover(SHOW_EVERYTHING);
    expect(plain.querySelector("button")!.textContent).toBe("Filter");

    document.body.innerHTML = "";
    const filtered = await renderPopover({ ...SHOW_EVERYTHING, hide_screenshots: true, media: "photos" });
    expect(filtered.querySelector("button")!.textContent).toBe("Filter2");
  });

  it("hands the toggled filter up", async () => {
    await renderPopover(SHOW_EVERYTHING);
    await open();
    await act(async () => {
      switchLabelled("Screenshots").click();
    });
    expect(onChange).toHaveBeenCalledWith({ ...SHOW_EVERYTHING, hide_screenshots: true });

    await act(async () => {
      switchLabelled("Favorites").click();
    });
    expect(onChange).toHaveBeenLastCalledWith({ ...SHOW_EVERYTHING, favorites: true });
  });

  it("disables reset and save on the default view", async () => {
    const saved = { ...SHOW_EVERYTHING, hide_screenshots: true };
    await renderPopover(saved, saved);
    await open();
    expect(document.body.textContent).toContain("This is your default view");
    expect(buttonByText("Reset to default").disabled).toBe(true);
    expect(buttonByText("Save as default").disabled).toBe(true);
  });

  it("offers reset and save when the view differs from the default", async () => {
    const saved = { ...SHOW_EVERYTHING, hide_screenshots: true };
    await renderPopover({ ...saved, hide_documents: true }, saved);
    await open();
    expect(document.body.textContent).toContain("Your default: No screenshots");

    await act(async () => {
      buttonByText("Save as default").click();
    });
    expect(onSaveDefault).toHaveBeenCalledTimes(1);

    await act(async () => {
      buttonByText("Reset to default").click();
    });
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("names the media type control and waits for the saved default", async () => {
    await renderPopover(SHOW_EVERYTHING, SHOW_EVERYTHING, false);
    expect(document.body.querySelector("button")!.disabled).toBe(true);

    document.body.innerHTML = "";
    await renderPopover(SHOW_EVERYTHING);
    await open();
    expect(document.body.querySelector('[aria-label="Media type"]')).not.toBeNull();
  });

  it("shrinks to an icon with a count on a phone", async () => {
    const wide = window.matchMedia;
    // @ts-ignore - every media query matches: the phone layout
    window.matchMedia = (query: string) => ({ ...wide(query), matches: true });
    try {
      await renderPopover({ ...SHOW_EVERYTHING, hide_documents: true });
      const button = document.body.querySelector("button")!;
      expect(button.getAttribute("aria-label")).toBe("Filter, 1 filter active");
      expect(button.textContent).toBe("");
    } finally {
      window.matchMedia = wide;
    }
  });
});
