/**
 * The password fields of the admin's user dialog and the Profile page, in a form that holds them
 * the way those two do (`withNewPassword` in its schema).
 *
 * - The lock that unlocks the fields was a <span> with a click handler, so keyboard and screen
 *   reader users could not change their password.
 * - Once unlocked, the empty field turned red before anything was typed: "cannot be blank" waits
 *   until a field is left or the form is submitted.
 * - #2197: locking the fields again looked like "never mind" but kept the typed password, and the
 *   next save of the profile or the user changed it anyway.
 */
import { MantineProvider } from "@mantine/core";
import { schemaResolver, useForm } from "@mantine/form";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { useTranslation } from "react-i18next";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defined } from "../../util/defined.test-utils";
import { withNewPassword, type NewPasswordFields } from "../../util/formSchemas";
import { PasswordEntry } from "./PasswordEntry";
import { passwordMessages } from "./PasswordEntry.schema";

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

type HarnessProps = Readonly<{ createNew: boolean; onSave: (values: NewPasswordFields) => void }>;

function Harness({ createNew, onSave }: HarnessProps) {
  const { t } = useTranslation();
  const form = useForm<NewPasswordFields>({
    initialValues: { password: "", passwordConfirm: "", changePassword: false },
    validate: schemaResolver(
      withNewPassword(
        z.object({ password: z.string(), passwordConfirm: z.string(), changePassword: z.boolean() }),
        passwordMessages(t),
        { required: createNew }
      ),
      { sync: true }
    ),
  });
  return (
    <form onSubmit={form.onSubmit(onSave)}>
      <PasswordEntry form={form} createNew={createNew} />
    </form>
  );
}

async function render({ createNew = false } = {}) {
  const onSave = vi.fn<(values: NewPasswordFields) => void>();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MantineProvider>
        <Harness createNew={createNew} onSave={onSave} />
      </MantineProvider>
    );
  });
  cleanup = async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  };
  const inputs = () => [...container.querySelectorAll<HTMLInputElement>('input[type="password"]')];
  const findLock = () =>
    container.querySelector<HTMLButtonElement>('button[aria-label="settings.password.tooltipeditbutton"]');
  const lock = () => defined(findLock(), "the lock button");
  // React tracks the previous value on the node itself, so a plain assignment is swallowed.
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  const type = async (index: number, value: string) => {
    const input = defined(inputs()[index], `password input ${index}`);
    await act(async () => {
      setValue?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  // The unlocked inputs are `required`; the event goes past the browser's own check, as a form
  // with other invalid fields would let it.
  const submit = async () => {
    const form = defined(container.querySelector("form"), "the form");
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
  };
  return { container, inputs, lock, findLock, type, submit, onSave };
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
    const { container, submit, onSave } = await render({ createNew: true });

    expect(container.textContent).not.toContain("settings.password.errorcannotbeblank");

    await submit();
    expect(container.textContent).toContain("settings.password.errorcannotbeblank");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("drops a shown 'cannot be blank' once a password is typed", async () => {
    const { container, type, submit } = await render({ createNew: true });
    await submit();
    expect(container.textContent).toContain("settings.password.errorcannotbeblank");

    await type(1, "s");

    expect(container.textContent).not.toContain("settings.password.errorcannotbeblank");
  });

  it("shows no lock when a new password is set", async () => {
    const { inputs, findLock } = await render({ createNew: true });

    expect(findLock()).toBeNull();
    expect(inputs().every(input => !input.disabled)).toBe(true);
  });

  it("saves no password, and asks for none, while the fields stay locked", async () => {
    const { submit, onSave } = await render();

    await submit();

    expect(onSave.mock.lastCall?.[0]).toEqual({ password: "", passwordConfirm: "", changePassword: false });
  });

  it("hands the parent a password typed twice alike", async () => {
    const { lock, type, submit, onSave } = await render();
    await act(async () => {
      lock().click();
    });
    await type(0, "s3cret");
    await type(1, "s3cret");

    await submit();

    expect(onSave.mock.lastCall?.[0]).toEqual({ password: "s3cret", passwordConfirm: "s3cret", changePassword: true });
  });

  it("says the passwords must match, and asks for the retype on submit", async () => {
    const { container, type, submit, onSave } = await render({ createNew: true });

    await type(0, "s3cret");
    expect(container.textContent).not.toContain("settings.password.errormustretype");

    await submit();
    expect(container.textContent).toContain("settings.password.errormustretype");

    await type(1, "s3crex");
    expect(container.textContent).toContain("settings.password.errormustmatch");
    await submit();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("follows both fields with 'must match'", async () => {
    const { container, type } = await render({ createNew: true });

    await type(1, "s3cret");
    expect(container.textContent).toContain("settings.password.errormustmatch");

    await type(0, "s3cret");
    expect(container.textContent).not.toContain("settings.password.errormustmatch");

    await type(0, "s3cre");
    expect(container.textContent).toContain("settings.password.errormustmatch");
  });

  it("drops the typed password when the fields are locked again", async () => {
    const { container, inputs, lock, type, submit, onSave } = await render();
    await act(async () => {
      lock().click();
    });
    await type(0, "s3cret");
    await type(1, "s3crex");
    expect(container.textContent).toContain("settings.password.errormustmatch");

    await act(async () => {
      lock().click();
    });

    expect(inputs().map(input => input.value)).toEqual(["", ""]);
    expect(container.textContent).not.toContain("settings.password.error");
    await submit();
    expect(onSave.mock.lastCall?.[0]).toEqual({ password: "", passwordConfirm: "", changePassword: false });

    await act(async () => {
      lock().click();
    });
    expect(inputs().map(input => input.value)).toEqual(["", ""]);
  });
});
