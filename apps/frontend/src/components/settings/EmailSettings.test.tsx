/**
 * Failed saves of the email settings follow the rules of util/apiErrors.ts.
 *
 * - A 401 raised a "could not be saved" toast on top of the auth handling.
 * - Removing the stored credential failed without a word.
 */
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { EmailConfigUpdate } from "../../api_client/settings/hooks/useEmailConfig";
import { EmailSettings } from "./EmailSettings";

/** The mutate options EmailSettings passes when it saves. */
type SaveOptions = { onSuccess?: () => void; onError?: (error: unknown) => void };
/** The mutate options EmailSettings passes when it sends a test email. */
type TestOptions = {
  onSuccess?: (result: { status: true; message: string }) => void;
  onError?: (error: unknown) => void;
};

const mocks = vi.hoisted(() => {
  class ApiError extends Error {
    constructor(
      message: string,
      public status: number,
      public serverMessage: string | null
    ) {
      super(message);
    }
  }
  return {
    ApiError,
    save: vi.fn<(config: EmailConfigUpdate, options?: SaveOptions) => void>(),
    sendTest: vi.fn<(to: string | undefined, options?: TestOptions) => void>(),
    error: vi.fn<(message: string) => void>(),
    success: vi.fn<(message: string) => void>(),
    configQuery: {
      isLoading: false,
      data: {
        provider: "custom",
        from_email: "photos@example.com",
        host: "smtp.example.com",
        port: 587,
        use_tls: true,
        use_ssl: false,
        username: "photos",
        has_secret: true,
        is_configured: true,
        presets: {},
      },
    },
  };
});

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("../../service/notifications", () => ({ notification: { error: mocks.error, success: mocks.success } }));
vi.mock("../../api_client/api", () => ({ ApiError: mocks.ApiError }));
vi.mock("../../api_client/settings/hooks/useEmailConfig", () => ({
  // One object, as React Query hands out: a new one per render would reset the form every render.
  useGetEmailConfigQuery: () => mocks.configQuery,
  useUpdateEmailConfigMutation: () => ({ mutate: mocks.save, isPending: false }),
  useSendTestEmailMutation: () => ({ mutate: mocks.sendTest, isPending: false }),
}));

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom has none; the provider Select's dropdown uses it.
  globalThis.ResizeObserver = class implements ResizeObserver {
    observe() {}

    unobserve() {}

    disconnect() {}
  };
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

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(async () => {
  mocks.save.mockReset();
  mocks.sendTest.mockReset();
  mocks.error.mockReset();
  mocks.success.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <MantineProvider>
        <EmailSettings />
      </MantineProvider>
    );
  });
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

/** Remove the stored credential, with the save failing with `error`. */
async function clearSecretFailingWith(error: unknown) {
  mocks.save.mockImplementation((_data, options) => options?.onError?.(error));
  const clear = [...container.querySelectorAll("button")].find(
    button => button.textContent?.trim() === "emailsettings.clear_secret"
  );
  if (!clear) throw new Error("no button removes the stored credential");
  await act(async () => {
    clear.click();
  });
}

describe("EmailSettings save errors", () => {
  it("shows the server's message", async () => {
    await clearSecretFailingWith(new mocks.ApiError("API error: 400", 400, "Unknown provider."));

    expect(mocks.error).toHaveBeenCalledWith("Unknown provider.");
  });

  it("falls back to the translated message when the server sent none", async () => {
    await clearSecretFailingWith(new mocks.ApiError("Internal Server Error", 500, null));

    expect(mocks.error).toHaveBeenCalledWith("emailsettings.savefailed");
  });

  it("leaves a 401 to the auth handling", async () => {
    await clearSecretFailingWith(new mocks.ApiError("Authentication failed", 401, null));

    expect(mocks.error).not.toHaveBeenCalled();
  });
});

/** Send a test email, the send ending the way `outcome` says. */
async function sendTestEmail(outcome: (options?: TestOptions) => void) {
  mocks.sendTest.mockImplementation((_to, options) => outcome(options));
  const send = [...container.querySelectorAll("button")].find(
    button => button.textContent?.trim() === "emailsettings.sendtest"
  );
  if (!send) throw new Error("no button sends a test email");
  await act(async () => {
    send.click();
  });
}

describe("EmailSettings test email", () => {
  it("shows the mail server's refusal from the 502", async () => {
    await sendTestEmail(options =>
      options?.onError?.(new mocks.ApiError("API error: 502", 502, "535 Authentication failed"))
    );

    expect(container.textContent).toContain("535 Authentication failed");
  });

  it("falls back to the translated message when the server sent none", async () => {
    await sendTestEmail(options => options?.onError?.(new TypeError("Failed to fetch")));

    expect(container.textContent).toContain("emailsettings.testfailed");
  });

  it("shows where a sent test went", async () => {
    await sendTestEmail(options => options?.onSuccess?.({ status: true, message: "Test email sent to a@b.c." }));

    expect(container.textContent).toContain("Test email sent to a@b.c.");
  });
});

// React tracks the previous value on the node itself, so a plain assignment is swallowed.
const setInputValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;

function field(selector: string): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>(selector);
  if (!input) throw new Error(`no input matches ${selector}`);
  return input;
}

async function type(selector: string, value: string) {
  const input = field(selector);
  await act(async () => {
    setInputValue?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function saveButton(): HTMLButtonElement {
  const save = [...container.querySelectorAll("button")].find(button => button.textContent?.trim() === "save");
  if (!save) throw new Error("no Save button");
  return save;
}

async function save() {
  await act(async () => {
    saveButton().click();
  });
  const call = mocks.save.mock.calls[0];
  if (!call) throw new Error("Save sent nothing");
  return call;
}

const HOST = 'input[placeholder="smtp.example.org"]';

describe("EmailSettings save", () => {
  it("only offers Save once a field differs from the stored settings", async () => {
    expect(saveButton().disabled).toBe(true);

    await type(HOST, "smtp2.example.com");
    expect(saveButton().disabled).toBe(false);

    await type(HOST, "smtp.example.com");
    expect(saveButton().disabled).toBe(true);
  });

  it("sends every setting with the edits and leaves the stored credential alone", async () => {
    await type(HOST, "smtp2.example.com");
    await type('input[type="number"]', "2525");

    const [payload] = await save();

    expect(payload).toEqual({
      provider: "custom",
      from_email: "photos@example.com",
      host: "smtp2.example.com",
      port: 2525,
      use_tls: true,
      use_ssl: false,
      username: "photos",
    });
  });

  it("sends a typed credential and empties the field once it is saved", async () => {
    await type('input[type="password"]', "hunter2");

    const [payload, options] = await save();
    expect(payload.secret).toBe("hunter2");

    await act(async () => options?.onSuccess?.());
    expect(field('input[type="password"]').value).toBe("");
    expect(saveButton().disabled).toBe(true);
    expect(mocks.success).toHaveBeenCalledWith("emailsettings.saved");
  });
});

describe("EmailSettings validation", () => {
  // The server refuses a port below 1 as well; the field now says so before the save.
  it("refuses a port below 1 at the field", async () => {
    await type('input[type="number"]', "0");

    await act(async () => {
      saveButton().click();
    });

    expect(mocks.save).not.toHaveBeenCalled();
    expect(container.textContent).toContain("emailsettings.errorport");
  });
});
