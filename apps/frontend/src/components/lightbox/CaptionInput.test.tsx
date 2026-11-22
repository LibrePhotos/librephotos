import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { CaptionInput } from "./CaptionInput";
import classes from "./CaptionInput.module.css";

const HASHTAGS = ["beach", "bear", "city"];

beforeAll(async () => {
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

afterEach(() => {
  document.body.innerHTML = "";
});

async function mount(caption: string, editable = true, hashtags: readonly string[] = HASHTAGS) {
  const onChange = vi.fn<(caption: string) => void>();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const render = async (isEditable: boolean) =>
    act(async () => {
      root.render(
        <MantineProvider env="test">
          <CaptionInput initialCaption={caption} editable={isEditable} hashtags={hashtags} onChange={onChange} />
        </MantineProvider>
      );
    });
  await render(editable);
  const textarea = defined(container.querySelector("textarea"));
  return { container, textarea, onChange, render };
}

const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;

async function typeAtEnd(textarea: HTMLTextAreaElement, text: string) {
  await act(async () => {
    setValue?.call(textarea, textarea.value + text);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function press(textarea: HTMLTextAreaElement, key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  await act(async () => {
    textarea.dispatchEvent(event);
  });
  return event;
}

const options = () => [...document.querySelectorAll<HTMLElement>("[role=option]")];
const optionTexts = () => options().map(option => option.textContent);

describe("CaptionInput", () => {
  it("shows the caption with its hashtags marked behind the text", async () => {
    const { container, textarea } = await mount("Sunset at the #beach");

    expect(textarea.value).toBe("Sunset at the #beach");
    expect(textarea.getAttribute("aria-label")).toBe("Caption");
    expect(container.querySelector(`mark.${defined(classes.hashtag)}`)?.textContent).toBe("#beach");
    expect(document.activeElement).toBe(textarea);
    expect(textarea.selectionStart).toBe(textarea.value.length);
  });

  it("offers the hashtags after a # and inserts the chosen one with Enter", async () => {
    const { textarea, onChange } = await mount("Trip");
    await typeAtEnd(textarea, " #be");

    expect(optionTexts()).toEqual(["#be", "#bear", "#beach"]);
    expect(textarea.getAttribute("aria-expanded")).toBe("true");
    expect(textarea.getAttribute("aria-activedescendant")).toBe(options()[0]?.id);

    await press(textarea, "ArrowDown");
    await press(textarea, "ArrowDown");
    expect(textarea.getAttribute("aria-activedescendant")).toBe(options()[2]?.id);
    const enter = await press(textarea, "Enter");

    expect(enter.defaultPrevented).toBe(true);
    expect(textarea.value).toBe("Trip #beach ");
    expect(onChange).toHaveBeenLastCalledWith("Trip #beach ");
    expect(textarea.selectionStart).toBe("Trip #beach ".length);
    expect(options()).toEqual([]);
  });

  it("wraps around with ArrowUp and accepts with Tab", async () => {
    const { textarea } = await mount("");
    await typeAtEnd(textarea, "#ci");

    await press(textarea, "ArrowUp");
    await press(textarea, "Tab");

    expect(textarea.value).toBe("#city ");
  });

  it("closes on Escape without the lightbox seeing the key", async () => {
    const { textarea } = await mount("");
    const outside = vi.fn<(event: KeyboardEvent) => void>();
    document.addEventListener("keydown", outside);
    await typeAtEnd(textarea, "#b");

    await press(textarea, "Escape");
    document.removeEventListener("keydown", outside);

    expect(options()).toEqual([]);
    expect(outside).not.toHaveBeenCalled();
    expect(textarea.value).toBe("#b");

    await act(async () => {
      textarea.dispatchEvent(new Event("select", { bubbles: true }));
    });
    expect(options()).toEqual([]);
    await typeAtEnd(textarea, "e");
    expect(optionTexts()).toEqual(["#be", "#bear", "#beach"]);
  });

  it("leaves Enter alone while an input method composes", async () => {
    const { textarea } = await mount("");
    await typeAtEnd(textarea, "#b");

    const enter = await press(textarea, "Enter", { isComposing: true });

    expect(enter.defaultPrevented).toBe(false);
    expect(textarea.value).toBe("#b");
  });

  it("says when there is nothing to suggest, and lets Enter start a new line", async () => {
    const { textarea } = await mount("", true, []);
    await typeAtEnd(textarea, "#");

    expect(document.body.textContent).toContain("No result");
    expect((await press(textarea, "Enter")).defaultPrevented).toBe(false);
  });

  it("takes a suggestion picked with the pointer", async () => {
    const { textarea } = await mount("");
    await typeAtEnd(textarea, "#bea");

    await act(async () => {
      defined(options().find(option => option.textContent === "#bear")).click();
    });

    expect(textarea.value).toBe("#bear ");
  });

  it("cannot be changed while not editable", async () => {
    const { textarea, render } = await mount("Saved");
    await render(false);

    expect(textarea.readOnly).toBe(true);
  });
});
