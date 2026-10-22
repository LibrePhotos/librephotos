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
import type { User, WorkerAvailabilityResponse } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { expectDisabledWithReason, focusAndReadTooltip } from "../common/disabledReason.test-utils";
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
    mutate: vi.fn<(user: Partial<User>, options?: SaveOptions) => void>(),
    generateAutoAlbums: vi.fn<() => void>(),
    updateUserError: vi.fn<(message: string) => void>(),
    regenerateEventTitles: vi.fn<() => void>(),
    applyDateRules: vi.fn<() => void>(),
    user,
    auth: { access: { is_admin: true } },
    // useGetSettingsQuery's answer.
    settings: { nextcloud_enabled: true, ocr_model: "none" } as Record<string, unknown>,
    // useWorkerQuery's answer; undefined until the server answers.
    worker: { data: { queue_can_accept_job: true } } as { data?: Partial<WorkerAvailabilityResponse> },
  };
});

const noopMutation = { mutate: () => {}, mutateAsync: async () => {}, isPending: false };

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("../../api_client/api", () => ({ ApiError: mocks.ApiError }));
vi.mock("../../api_client/urls", () => ({ serverAddress: "" }));
vi.mock("../../api_client/auth/hooks", () => ({ useAccessToken: () => ({ data: mocks.auth }) }));
vi.mock("../../api_client/faces", () => ({
  useRescanFacesMutation: () => noopMutation,
  useTrainFacesMutation: () => noopMutation,
}));
vi.mock("../../api_client/folders/hooks/useFetchNextcloudDirsQuery", () => ({
  useFetchNextcloudDirsQuery: () => ({ isFetching: false, isSuccess: false, isError: false, data: [] }),
}));
vi.mock("../../api_client/jobs/hooks", () => ({
  useApplyDateRules: () => ({ start: mocks.applyDateRules, running: false }),
  useGenerateAutoAlbumsMutation: () => ({ ...noopMutation, mutate: mocks.generateAutoAlbums }),
  useGenerateCaptionsMutation: () => noopMutation,
  useFindThingsMutation: () => noopMutation,
  useGenerateOcrMutation: () => noopMutation,
  useRegenerateEventTitlesMutation: () => ({ ...noopMutation, mutate: mocks.regenerateEventTitles }),
  useRescanPhotosMutation: () => noopMutation,
  useScanNextcloudPhotosMutation: () => noopMutation,
  useScanPhotosMutation: () => noopMutation,
  useWorkerQuery: () => mocks.worker,
}));
vi.mock("../../api_client/photos/hooks", () => ({ useDeleteMissingPhotosMutation: () => noopMutation }));
vi.mock("../../api_client/settings/hooks", () => ({
  useGetSettingsQuery: () => ({ data: mocks.settings }),
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
        return () => {};
      },
    }
  ),
}));
vi.mock("../CountStats", () => ({ CountStats: () => null }));
vi.mock("../modals/ModalNextcloudScanDirectoryEdit", () => ({ ModalNextcloudScanDirectoryEdit: () => null }));
vi.mock("../modals/ModalUserEdit", () => ({ ModalUserEdit: () => null }));
vi.mock("./ProcessingStatusCard", () => ({ ProcessingStatusCard: () => null }));
vi.mock("../libraryfolders/LibraryFoldersCard", () => ({ LibraryFoldersCard: () => null }));
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
  mocks.mutate.mockReset();
  mocks.generateAutoAlbums.mockReset();
  mocks.updateUserError.mockReset();
  mocks.regenerateEventTitles.mockReset();
  mocks.worker = { data: { queue_can_accept_job: true } };
  mocks.settings = { nextcloud_enabled: true, ocr_model: "none" };
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
const chevronByLabel = (label: string) =>
  found(container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`), `chevron "${label}"`);
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
    expect(defined(mocks.mutate.mock.calls[0])[0]).toMatchObject({
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

// #2224: the "Save changes?" prompt is what guards leaving the page (SaveChangesDialog.leaving.test.tsx),
// so it has to be open exactly while edits are pending: from the first edit until Save or Cancel.
describe("Library unsaved edits", () => {
  const prompt = () => document.body.querySelector('[data-testid="save-dialog"]');

  it("guards leaving after an edit, and no longer after Cancel", async () => {
    expect(prompt()).toBeNull();
    await setInputValue(byPlaceholder("User name"), "mara");
    expect(prompt()).not.toBeNull();

    await click(buttonByText("dialog-cancel"));

    expect(prompt()).toBeNull();
  });

  it("no longer guards leaving once the save went through", async () => {
    mocks.mutate.mockImplementation((_data, options) => options?.onSuccess?.());
    await setInputValue(byPlaceholder("User name"), "mara");

    await click(buttonByText("dialog-save"));

    expect(prompt()).toBeNull();
  });
});

/** Mounts the page afresh with this worker answer (a new mount, as on a page load). */
const rerender = async (worker: typeof mocks.worker) => {
  mocks.worker = worker;
  await act(async () => {
    root.unmount();
  });
  root = createRoot(container);
  await act(async () => {
    root.render(
      <MantineProvider>
        <Library />
      </MantineProvider>
    );
  });
};

const SCAN_JOB = {
  id: 7,
  job_id: "abc",
  queued_at: "2026-10-10T10:00:00Z",
  started_at: "2026-10-10T10:00:01Z",
  finished_at: null,
  finished: false,
  failed: false,
  cancelled: false,
  job_type_str: "Scan Photos",
  job_type: 1,
  started_by: { id: 1, username: "admin", first_name: "Ada", last_name: "" },
  progress_target: 10,
  progress_current: 2,
};

// #2237: every job button was disabled while any job ran, and before the worker status had loaded,
// with nothing on the page saying why.
describe("Library while a job runs", () => {
  it("names the running job above the buttons and links to the job list", async () => {
    await rerender({ data: { status: true, queue_can_accept_job: false, job_detail: SCAN_JOB } });

    const notice = found(container.querySelector("[data-testid=job-queue-busy]"), "the busy notice");
    expect(notice.textContent).toContain("A job is running: Scan Photos");
    expect(notice.querySelector("a")?.getAttribute("href")).toBe("/jobs");
  });

  it("says another user's job is running without naming it", async () => {
    await rerender({ data: { status: true, queue_can_accept_job: false, job_detail: null } });

    const notice = found(container.querySelector("[data-testid=job-queue-busy]"), "the busy notice");
    expect(notice.textContent).toContain("Another user's job is running");
    expect(notice.querySelector("a")).toBeNull();
  });

  it("gives every job button the reason", async () => {
    await rerender({ data: { status: true, queue_can_accept_job: false, job_detail: null } });

    for (const label of [
      i18n.t("settings.statusscanphotosfalse"),
      i18n.t("settings.generate"),
      i18n.t("settings.reapplydaterulesbutton"),
    ]) {
      const button = buttonByText(label);
      expectDisabledWithReason(button, i18n.t("jobs.queuebusy.reason"));
      expect(await focusAndReadTooltip(button)).toContain(i18n.t("jobs.queuebusy.reason"));
    }
    await click(buttonByText(i18n.t("settings.generate")));
    expect(mocks.generateAutoAlbums).not.toHaveBeenCalled();
    await click(buttonByText(i18n.t("settings.reapplydaterulesbutton")));
    expect(mocks.applyDateRules).not.toHaveBeenCalled();
  });

  // #2621: the chevrons beside Scan and text recognition were a plain `disabled`: no reason, no focus.
  it("gives the scan and OCR chevrons the reason too, and keeps their menus shut", async () => {
    await rerender({ data: { status: true, queue_can_accept_job: false, job_detail: null } });

    for (const label of ["Rescan", "Extract text again for all photos"]) {
      const chevron = chevronByLabel(label);
      expectDisabledWithReason(chevron, i18n.t("jobs.queuebusy.reason"));
      expect(await focusAndReadTooltip(chevron)).toContain(i18n.t("jobs.queuebusy.reason"));
      await click(chevron);
      expect(chevron.getAttribute("aria-expanded")).toBe("false");
    }
  });

  it("does not report the queue busy before the worker status has loaded", async () => {
    await rerender({ data: undefined });

    expect(container.querySelector("[data-testid=job-queue-busy]")).toBeNull();
    const generate = buttonByText(i18n.t("settings.generate"));
    expect(generate.getAttribute("aria-disabled")).toBeNull();
    expect(generate.disabled).toBe(false);
  });
});

describe("Library actions", () => {
  it("regenerates the titles of the existing event albums", async () => {
    await click(buttonByText("Regenerate"));

    expect(mocks.regenerateEventTitles).toHaveBeenCalledTimes(1);
    expect(mocks.generateAutoAlbums).not.toHaveBeenCalled();
  });

  // #437: the date rules only applied to photos scanned after a change.
  it("applies the date rules to the photos already in the library", async () => {
    expect(container.textContent).toContain("Apply date rules to existing photos");
    expect(container.textContent).toContain("A date you set by hand is never changed.");

    await click(buttonByText("Apply"));

    expect(mocks.applyDateRules).toHaveBeenCalledTimes(1);
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

  it("opens the rescan menu from its chevron", async () => {
    const chevron = chevronByLabel("Rescan");
    expect(chevron.getAttribute("aria-disabled")).toBeNull();

    await click(chevron);

    expect(chevron.getAttribute("aria-expanded")).toBe("true");
  });

  it("says why the OCR chevron is off while text recognition is off", async () => {
    const chevron = chevronByLabel("Extract text again for all photos");

    expectDisabledWithReason(chevron, i18n.t("settings.ocrdisabled"));
    await click(chevron);
    expect(chevron.getAttribute("aria-expanded")).toBe("false");
  });

  it("announces the scan and OCR chevrons as menu buttons", () => {
    for (const label of ["Rescan", "Extract text again for all photos"]) {
      expect(container.querySelector(`button[aria-label="${label}"]`)?.getAttribute("aria-haspopup")).toBe("menu");
    }
  });
});

describe("Library captions (#2211)", () => {
  const rerender = async () => {
    await act(async () => {
      root.render(
        <MantineProvider>
          <Library />
        </MantineProvider>
      );
    });
  };

  it("has no Captions section while the server cannot generate captions", () => {
    expect(container.textContent).not.toContain("Generate captions");
  });

  it("shows the Captions section when captioning is available", async () => {
    mocks.settings = { ...mocks.settings, captioning_available: true };
    await rerender();

    expect(container.textContent).toContain("Generate captions");
    expect(chevronByLabel("Generate captions again for all photos")).toBeTruthy();
  });

  it("hides it again when captioning is turned off", async () => {
    mocks.settings = { ...mocks.settings, captioning_available: false };
    await rerender();

    expect(container.textContent).not.toContain("Generate captions");
  });
});

describe("Library link to the Admin Area (#2037)", () => {
  const adminLink = () =>
    [...container.querySelectorAll("a")].find(link => link.textContent === "Change scan directories in the Admin Area");

  it("is not there for a user who cannot open the Admin Area", () => {
    expect(adminLink()).toBeUndefined();
  });

  it("takes a superuser to the users table, where the scan directories are set", async () => {
    mocks.user = { ...mocks.user, is_superuser: true };
    await act(async () => {
      root.render(
        <MantineProvider>
          <Library />
        </MantineProvider>
      );
    });

    expect(adminLink()?.getAttribute("href")).toBe("/admin");
    expect(adminLink()?.getAttribute("hash")).toBe("admin-users");
  });
});
