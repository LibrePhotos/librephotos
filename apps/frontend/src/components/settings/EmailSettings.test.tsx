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
    showNotification: vi.fn<(notification: { message: string; color: string }) => void>(),
  };
});

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@mantine/notifications", () => ({ showNotification: mocks.showNotification }));
vi.mock("../../api_client/api", () => ({ ApiError: mocks.ApiError }));
vi.mock("../../api_client/settings/hooks/useEmailConfig", () => ({
  useGetEmailConfigQuery: () => ({
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
  }),
  useUpdateEmailConfigMutation: () => ({ mutate: mocks.save, isPending: false }),
  useSendTestEmailMutation: () => ({ mutate: () => {}, isPending: false }),
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
  mocks.showNotification.mockReset();
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

    expect(mocks.showNotification).toHaveBeenCalledWith({ message: "Unknown provider.", color: "red" });
  });

  it("falls back to the translated message when the server sent none", async () => {
    await clearSecretFailingWith(new mocks.ApiError("Internal Server Error", 500, null));

    expect(mocks.showNotification).toHaveBeenCalledWith({ message: "emailsettings.savefailed", color: "red" });
  });

  it("leaves a 401 to the auth handling", async () => {
    await clearSecretFailingWith(new mocks.ApiError("Authentication failed", 401, null));

    expect(mocks.showNotification).not.toHaveBeenCalled();
  });
});
