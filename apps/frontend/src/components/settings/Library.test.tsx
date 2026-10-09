/**
 * Library page behaviour around saving the profile and the Nextcloud credentials.
 *
 * - The Nextcloud server address and username inputs were bound to the saved
 *   profile while their handlers wrote the pending edits, so React reset the
 *   field after every keystroke and nothing could be typed.
 * - Each handler started from the saved profile, so typing the app password
 *   dropped an address entered just before.
 * - A rejected save closed the "Save changes?" dialog without a word.
 * - "Regenerate Event Titles" ran Generate Event Albums instead.
 */
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "../../api_client/user/types";
import i18n from "../../i18n";
import { Library } from "./Library";

/** The mutate options Library passes when it saves the profile. */
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
  const user: Partial<User> = {};
  return {
    ApiError,
    post: vi.fn<(url: string, body: unknown) => Promise<unknown>>(),
    mutate: vi.fn<(user: Partial<User>, options?: SaveOptions) => void>(),
    generateAutoAlbums: vi.fn<() => void>(),
    updateUserError: vi.fn<(message: string) => void>(),
    regenerateEventAlbums: vi.fn<() => void>(),
    user,
    auth: { access: { is_admin: true } },
  };
});

const noopMutation = { mutate: () => {}, mutateAsync: async () => {}, isPending: false };

vi.mock("../../api_client/api", () => ({
  ApiError: mocks.ApiError,
  fetchClient: { get: () => Promise.resolve(), post: mocks.post },
}));
vi.mock("../../api_client/apiClient", () => ({ serverAddress: "" }));
vi.mock("../../api_client/auth/hooks", () => ({ useAccessToken: () => ({ data: mocks.auth }) }));
vi.mock("../../api_client/faces", () => ({ useTrainFacesMutation: () => noopMutation }));
vi.mock("../../api_client/folders/hooks/useFetchNextcloudDirsQuery", () => ({
  useFetchNextcloudDirsQuery: () => ({ isFetching: false, isSuccess: false, isError: false, data: [] }),
}));
vi.mock("../../api_client/jobs/hooks", () => ({
  useGenerateAutoAlbumsMutation: () => ({ ...noopMutation, mutate: mocks.generateAutoAlbums }),
  useGenerateOcrMutation: () => noopMutation,
  useRescanPhotosMutation: () => noopMutation,
  useScanNextcloudPhotosMutation: () => noopMutation,
  useScanPhotosMutation: () => noopMutation,
  useWorkerQuery: () => ({ data: { queue_can_accept_job: true } }),
}));
vi.mock("../../api_client/photos/hooks", () => ({ useDeleteMissingPhotosMutation: () => noopMutation }));
vi.mock("../../api_client/settings/hooks", () => ({
  useGetSettingsQuery: () => ({ data: { nextcloud_enabled: true, ocr_model: "none" } }),
}));
vi.mock("../../api_client/stats/hooks", () => ({ useFetchCountStatsQuery: () => ({ data: undefined }) }));
vi.mock("../../api_client/user/hooks", () => ({
  useFetchUserListQuery: () => ({ data: [] }),
  useUpdateUserMutation: () => ({ mutate: mocks.mutate, isPending: false }),
}));
vi.mock("../../api_client/user/hooks/useCurrentUserSelfDetailsQuery", () => ({
  useCurrentUserSelfDetailsQuery: () => ({ data: mocks.user }),
}));
vi.mock("../../service/notifications", () => ({
  notification: new Proxy<Record<string, unknown>>(
    {},
    {
      get: (_target, key) => {
        if (key === "updateUserError") return mocks.updateUserError;
        if (key === "regenerateEventAlbums") return mocks.regenerateEventAlbums;
        return () => {};
      },
    }
  ),
}));
vi.mock("../CountStats", () => ({ CountStats: () => null }));
vi.mock("../modals/ModalNextcloudScanDirectoryEdit", () => ({ ModalNextcloudScanDirectoryEdit: () => null }));
vi.mock("../modals/ModalUserEdit", () => ({ ModalUserEdit: () => null }));
// The dialog itself is covered in SaveChangesDialog.test.tsx; here only whether it is open.
vi.mock("./SaveChangesDialog", () => ({
  SaveChangesDialog: ({ opened, onSave, onCancel }: { opened: boolean; onSave: () => void; onCancel: () => void }) =>
    opened ? (
      <div data-testid="save-dialog">
        <button type="button" onClick={onSave}>
          dialog-save
        </button>
        <button type="button" onClick={onCancel}>
          dialog-cancel
        </button>
      </div>
    ) : null,
}));

beforeAll(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  // The assertions read the English labels.
  await i18n.changeLanguage("en");
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
  mocks.post.mockReset().mockResolvedValue({});
  mocks.mutate.mockReset();
  mocks.generateAutoAlbums.mockReset();
  mocks.updateUserError.mockReset();
  mocks.regenerateEventAlbums.mockReset();
  mocks.user = {
    id: 1,
    username: "admin",
    scan_directory: "/data",
    nextcloud_server_address: "",
    nextcloud_username: "",
    nextcloud_scan_directory: "",
    stack_raw_jpeg: true,
  };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <MantineProvider>
        <Library />
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

function found<T>(element: T | null | undefined, what: string): T {
  if (element === null || element === undefined) throw new Error(`${what} not found`);
  return element;
}

const setInputValue = async (input: HTMLInputElement, value: string) => {
  // React tracks the value itself; set it the way a browser does so onChange fires.
  const setter = found(Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set, "value setter");
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

const byPlaceholder = (key: string) =>
  found(container.querySelector<HTMLInputElement>(`input[placeholder="${key}"]`), `input "${key}"`);
const buttonByText = (text: string) =>
  found(
    [...document.body.querySelectorAll("button")].find(button => button.textContent?.trim() === text),
    `button "${text}"`
  );
const click = async (element: HTMLElement) => {
  await act(async () => {
    element.click();
  });
};

describe("Library Nextcloud settings", () => {
  it("keeps what is typed into the server address and username", async () => {
    const address = byPlaceholder("https://");
    const username = byPlaceholder("User name");

    await setInputValue(address, "https://cloud.example.com");
    await setInputValue(username, "mara");

    expect(address.value).toBe("https://cloud.example.com");
    expect(username.value).toBe("mara");
  });

  it("saves every Nextcloud field typed before the save", async () => {
    await setInputValue(byPlaceholder("https://"), "https://cloud.example.com");
    await setInputValue(byPlaceholder("User name"), "mara");
    await setInputValue(
      found(container.querySelector<HTMLInputElement>('input[type="password"]'), "password input"),
      "app-secret"
    );

    await click(buttonByText("dialog-save"));

    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    expect(mocks.mutate.mock.calls[0][0]).toMatchObject({
      nextcloud_server_address: "https://cloud.example.com",
      nextcloud_username: "mara",
      nextcloud_app_password: "app-secret",
    });
  });

  it("reports a rejected save and keeps the dialog open", async () => {
    mocks.mutate.mockImplementation((_data, options) =>
      options?.onError?.(new mocks.ApiError("API error: 400", 400, "The address must start with https://."))
    );
    await setInputValue(byPlaceholder("https://"), "cloud.example.com");

    await click(buttonByText("dialog-save"));

    expect(mocks.updateUserError).toHaveBeenCalledWith("The address must start with https://.");
    expect(document.body.querySelector('[data-testid="save-dialog"]')).not.toBeNull();
  });
});

describe("Library actions", () => {
  it("regenerates the titles of the existing event albums", async () => {
    await click(buttonByText("Regenerate"));

    expect(mocks.post).toHaveBeenCalledWith("/autoalbumtitlegen/", {});
    expect(mocks.generateAutoAlbums).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(mocks.regenerateEventAlbums).toHaveBeenCalledTimes(1));
  });

  it("opens the scan help from the button itself", async () => {
    const help = found(
      container.querySelector<HTMLButtonElement>('button[aria-label="How scanning works"]'),
      "scan help button"
    );
    expect(help.getAttribute("aria-expanded")).toBe("false");

    await click(help);

    expect(help.getAttribute("aria-expanded")).toBe("true");
  });

  it("announces the scan and OCR chevrons as menu buttons", () => {
    for (const label of ["Rescan", "Extract text again for all photos"]) {
      expect(container.querySelector(`button[aria-label="${label}"]`)?.getAttribute("aria-haspopup")).toBe("menu");
    }
  });
});
