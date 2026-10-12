/**
 * The lock that unlocks the password fields was a <span> with a click handler,
 * so keyboard and screen reader users could not change their password. Once
 * unlocked, the empty field also turned red before anything was typed.
 */
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { defined } from "../../util/defined.test-utils";
import { PasswordEntry } from "./PasswordEntry";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
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

let cleanup: (() => Promise<void>) | undefined;

afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

type PasswordEntryProps = React.ComponentProps<typeof PasswordEntry>;

async function render(props: Partial<PasswordEntryProps> = {}) {
  const onValidate = vi.fn<PasswordEntryProps["onValidate"]>();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const draw = async (next: Partial<PasswordEntryProps>) => {
    await act(async () => {
      root.render(
        <MantineProvider>
          <PasswordEntry onValidate={onValidate} {...next} />
        </MantineProvider>
      );
    });
  };
  await draw(props);
  cleanup = async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  };
  const inputs = () => [...container.querySelectorAll<HTMLInputElement>('input[type="password"]')];
  const findLock = () =>
    container.querySelector<HTMLButtonElement>('button[aria-label="settings.password.tooltipeditbutton"]');
  const lock = () => {
    const button = findLock();
    if (!button) throw new Error("no lock button");
    return button;
  };
  return { container, inputs, lock, findLock, draw, onValidate };
}

describe("PasswordEntry", () => {
  it("unlocks the fields from a real, focusable button", async () => {
    const { inputs, lock } = await render();

    const button = lock();
    expect(button.tagName).toBe("BUTTON");
    expect(button.type).toBe("button");
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(inputs().every(input => input.disabled)).toBe(true);

    await act(async () => {
      button.click();
    });

    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(inputs().every(input => !input.disabled)).toBe(true);
  });

  it("waits for the user to leave the field before calling it blank", async () => {
    const { container, inputs, lock } = await render();

    await act(async () => {
      lock().click();
    });
    expect(container.textContent).not.toContain("settings.password.errorcannotbeblank");

    await act(async () => {
      const input = defined(inputs()[0], "the password input");
      input.focus();
      input.blur();
    });
    expect(container.textContent).toContain("settings.password.errorcannotbeblank");
  });

  it("still flags a blank password when the form is submitted", async () => {
    const { container, draw } = await render({ createNew: true });

    expect(container.textContent).not.toContain("settings.password.errorcannotbeblank");

    await draw({ createNew: true, closing: true });
    expect(container.textContent).toContain("settings.password.errorcannotbeblank");
  });

  it("shows no lock when a new password is set", async () => {
    const { inputs, findLock } = await render({ createNew: true });

    expect(findLock()).toBeNull();
    expect(inputs().every(input => !input.disabled)).toBe(true);
  });

  it("re-validates on a mode change with the typed password, not on every render", async () => {
    const { inputs, draw, onValidate } = await render({ createNew: true });
    // React tracks the previous value on the node itself, so a plain assignment is swallowed.
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    for (const input of inputs()) {
      await act(async () => {
        setValue?.call(input, "s3cret");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }
    expect(onValidate).toHaveBeenLastCalledWith("s3cret", true);
    onValidate.mockClear();

    // A parent re-render is not a mode change
    await draw({ createNew: true });
    expect(onValidate).not.toHaveBeenCalled();

    await draw({ createNew: true, closing: true });
    expect(onValidate).toHaveBeenCalledTimes(1);
    expect(onValidate).toHaveBeenLastCalledWith("s3cret", true);
  });

  it("reports no password, and a valid form, while the fields stay locked", async () => {
    const { onValidate } = await render();

    expect(onValidate).toHaveBeenLastCalledWith("", true);
  });

  it("says the passwords must match, and asks for the retype on submit", async () => {
    const { container, inputs, draw, onValidate } = await render({ createNew: true });
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    const type = async (input: HTMLInputElement | undefined, value: string) => {
      await act(async () => {
        setValue?.call(defined(input), value);
        defined(input).dispatchEvent(new Event("input", { bubbles: true }));
      });
    };

    await type(inputs()[0], "s3cret");
    expect(onValidate).toHaveBeenLastCalledWith("", false);
    expect(container.textContent).not.toContain("settings.password.errormustretype");

    await draw({ createNew: true, closing: true });
    expect(container.textContent).toContain("settings.password.errormustretype");

    await type(inputs()[1], "s3crex");
    expect(container.textContent).toContain("settings.password.errormustmatch");
    expect(onValidate).toHaveBeenLastCalledWith("", false);
  });
});
