/**
 * #2311: nothing told an admin that a newer release was out. The Admin page now heads with an
 * Update available card: the release, the update steps for this install, its notes, Skip this
 * release (with Undo) and a close button that hides it for a week.
 */
import type { InstallState, UpdateStatus } from "@librephotos/api-client";
import React from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { click, renderInMantine, setUpMantineDom } from "../modals/confirmModal.test-utils";
import { UpdateAvailableCard } from "./UpdateAvailableCard";

type SkipOptions = { onSuccess?: () => void };

const stubs = vi.hoisted(() => ({
  skip: vi.fn<(version: string, options?: SkipOptions) => void>(),
  skipAsync: vi.fn<(version: string) => Promise<unknown>>(),
  snooze: vi.fn<() => void>(),
  download: vi.fn<(version: string) => void>(),
  toast:
    vi.fn<(id: string, count: number, message: (total: number) => unknown, options: { undo: () => unknown }) => void>(),
}));

vi.mock("../../api_client/server", () => ({
  useSkipReleaseMutation: () => ({ mutate: stubs.skip, mutateAsync: stubs.skipAsync, isPending: false }),
  useSnoozeUpdateNoticeMutation: () => ({ mutate: stubs.snooze, isPending: false }),
  useInstallUpdateMutation: () => ({ mutate: stubs.download, isPending: false }),
  useRestartToUpdateMutation: () => ({ mutate: vi.fn<(force: boolean) => void>(), isPending: false, error: null }),
}));
vi.mock("../../service/notifications", () => ({ notification: { successCounted: stubs.toast } }));

function status(overrides: Partial<UpdateStatus> = {}): UpdateStatus {
  return {
    enabled: true,
    locked: false,
    status: "available",
    current: "1.4.0",
    latest: "1.5.0",
    update_available: true,
    notice: true,
    release_url: "https://github.com/LibrePhotos/librephotos/releases/tag/1.5.0",
    published_at: "2026-11-14T10:00:00Z",
    checked_at: "2026-11-15T06:12:00Z",
    error: null,
    install_type: "docker",
    how_to_update_url: "https://docs.librephotos.com/docs/installation/upgrading",
    skipped_release: null,
    snoozed_until: null,
    ...overrides,
  };
}

function windowsApp(install: Partial<InstallState>): Partial<UpdateStatus> {
  return {
    install_type: "windows",
    how_to_update_url: "https://docs.librephotos.com/docs/installation/windows-standalone#updating",
    install: {
      supported: true,
      reason: null,
      state: "idle",
      version: null,
      received_bytes: 0,
      total_bytes: null,
      error: null,
      signature_checked: false,
      ...install,
    },
  };
}

function link(container: HTMLElement, text: string): HTMLAnchorElement {
  return defined(
    [...container.querySelectorAll("a")].find(anchor => anchor.textContent === text),
    `the ${text} link`
  );
}

function button(container: HTMLElement, label: string): HTMLButtonElement {
  return defined(
    [...container.querySelectorAll("button")].find(
      candidate => candidate.textContent === label || candidate.getAttribute("aria-label") === label
    ),
    `the ${label} button`
  );
}

beforeAll(async () => {
  setUpMantineDom();
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("UpdateAvailableCard", () => {
  it("names the release, the one running and when it came out", async () => {
    const { container } = await renderInMantine(<UpdateAvailableCard status={status()} />);
    expect(container.querySelector("h4")?.textContent).toBe("LibrePhotos 1.5.0 is available");
    expect(container.textContent).toContain("1.4.0 → 1.5.0");
    expect(container.textContent).toContain("You have 1.4.0. 1.5.0 was published on Nov 14, 2026.");
    expect(container.textContent).toContain("Nothing about this server is sent.");
  });

  it("links the update steps for this install and the release notes, in a new tab", async () => {
    const { container } = await renderInMantine(<UpdateAvailableCard status={status()} />);
    const steps = link(container, "How to update");
    expect(steps.href).toBe("https://docs.librephotos.com/docs/installation/upgrading");
    expect(steps.target).toBe("_blank");
    expect(link(container, "Release notes").href).toBe("https://github.com/LibrePhotos/librephotos/releases/tag/1.5.0");
  });

  it("names the Windows app's steps, and does without a date or notes it lacks", async () => {
    const { container } = await renderInMantine(
      <UpdateAvailableCard
        status={status({
          install_type: "windows",
          how_to_update_url: "https://docs.librephotos.com/docs/installation/windows-standalone#updating",
          published_at: null,
          release_url: null,
        })}
      />
    );
    expect(link(container, "How to update the Windows app").href).toContain("windows-standalone#updating");
    expect(container.textContent).toContain("You have 1.4.0.");
    expect(container.textContent).not.toContain("Release notes");
  });

  it("lets the Windows app download the release itself (#2788)", async () => {
    const { container } = await renderInMantine(<UpdateAvailableCard status={status(windowsApp({}))} />);
    expect(container.textContent).not.toContain("How to update the Windows app");
    await click(button(container, "Download update"));
    expect(stubs.download).toHaveBeenCalledWith("1.5.0");
    expect(link(container, "Release notes").href).toContain("releases/tag/1.5.0");
  });

  it("says why the Windows app cannot update itself, and links the steps", async () => {
    const { container } = await renderInMantine(
      <UpdateAvailableCard status={status(windowsApp({ supported: false, reason: "read_only" }))} />
    );
    expect(link(container, "How to update the Windows app").href).toContain("windows-standalone#updating");
    expect(container.textContent).toContain("LibrePhotos cannot update itself here");
    expect(container.textContent).not.toContain("Download update");
  });

  it("skips the release, with Undo in the toast", async () => {
    const { container } = await renderInMantine(<UpdateAvailableCard status={status()} />);
    await click(button(container, "Skip this release"));
    expect(stubs.skip).toHaveBeenCalledWith("1.5.0", expect.anything());

    defined(stubs.skip.mock.calls[0]?.[1]?.onSuccess, "the skip callback")();
    const [id, count, message, options] = defined(stubs.toast.mock.calls[0], "the toast");
    expect([id, count, message(1)]).toEqual([
      "release-skipped",
      1,
      "1.5.0 skipped. You will hear about the next release.",
    ]);
    await options.undo();
    expect(stubs.skipAsync).toHaveBeenCalledWith("");
  });

  it("closes for a week", async () => {
    const { container } = await renderInMantine(<UpdateAvailableCard status={status()} />);
    await click(button(container, "Remind me in 7 days"));
    expect(stubs.snooze).toHaveBeenCalledOnce();
  });
});
