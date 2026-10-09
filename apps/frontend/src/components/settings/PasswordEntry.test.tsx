/**
 * The lock that unlocks the password fields was a <span> with a click handler,
 * so keyboard and screen reader users could not change their password. Once
 * unlocked, the empty field also turned red before anything was typed.
 */
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PasswordEntry } from "./PasswordEntry";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
});

let cleanup: (() => Promise<void>) | undefined;

afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

async function render(props: Partial<React.ComponentProps<typeof PasswordEntry>> = {}) {
  const onValidate = vi.fn();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const draw = async (next: Partial<React.ComponentProps<typeof PasswordEntry>>) => {
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
  const lock = () =>
    container.querySelector<HTMLButtonElement>('button[aria-label="settings.password.tooltipeditbutton"]');
  return { container, inputs, lock, draw, onValidate };
}

describe("PasswordEntry", () => {
  it("unlocks the fields from a real, focusable button", async () => {
    const { inputs, lock } = await render();

    const button = lock()!;
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
      lock()!.click();
    });
    expect(container.textContent).not.toContain("settings.password.errorcannotbeblank");

    await act(async () => {
      inputs()[0].focus();
      inputs()[0].blur();
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
    const { inputs, lock } = await render({ createNew: true });

    expect(lock()).toBeNull();
    expect(inputs().every(input => !input.disabled)).toBe(true);
  });
});
