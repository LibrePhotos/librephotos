import { ApiError, type InstallState, type UpdateStatus } from "@librephotos/api-client";
import React from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { click, renderInMantine, setUpMantineDom } from "../modals/confirmModal.test-utils";
import { MoveToInstalledCard } from "./MoveToInstalledCard";
import { UpdateInstallPanel } from "./UpdateInstallPanel";

const stubs = vi.hoisted(() => ({
  move: vi.fn<() => void>(),
  restart: vi.fn<(force: boolean) => void>(),
  restartError: { current: null as Error | null },
}));

vi.mock("../../api_client/server", () => ({
  useMoveToInstalledMutation: () => ({ mutate: stubs.move, isPending: false }),
  useInstallUpdateMutation: () => ({ mutate: vi.fn<(version: string) => void>(), isPending: false }),
  useRestartToUpdateMutation: () => ({ mutate: stubs.restart, isPending: false, error: stubs.restartError.current }),
}));

function install(overrides: Partial<InstallState> = {}): InstallState {
  return {
    supported: true,
    reason: null,
    state: "idle",
    version: null,
    received_bytes: 0,
    total_bytes: null,
    error: null,
    signature_checked: false,
    kind: "update",
    layout: "portable",
    move_supported: true,
    move_reason: null,
    ...overrides,
  };
}

function status(state: InstallState): UpdateStatus {
  return {
    enabled: true,
    locked: false,
    status: "up_to_date",
    current: "1.7.0",
    latest: "1.7.0",
    update_available: false,
    notice: false,
    release_url: null,
    published_at: null,
    checked_at: null,
    error: null,
    install_type: "windows",
    how_to_update_url: "https://docs.librephotos.com/docs/installation/windows-standalone#updating",
    skipped_release: null,
    snoozed_until: null,
    install: state,
  };
}

function button(container: HTMLElement, label: string): HTMLButtonElement {
  return defined(
    [...container.querySelectorAll("button")].find(candidate => candidate.textContent === label),
    `the ${label} button`
  );
}

async function render(state: InstallState) {
  return renderInMantine(<MoveToInstalledCard status={status(state)} />);
}

beforeAll(async () => {
  setUpMantineDom();
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  document.body.innerHTML = "";
  stubs.restartError.current = null;
  vi.clearAllMocks();
});

describe("MoveToInstalledCard", () => {
  it("offers the move and says what stays", async () => {
    const { container } = await render(install());
    expect(container.textContent).toContain("runs from a folder you unzipped");
    expect(container.textContent).toContain("the installer of 1.7.0");
    await click(button(container, "Move to the installed version"));
    expect(stubs.move).toHaveBeenCalledOnce();
  });

  it("shows the download, then Restart to finish moving", async () => {
    const downloading = install({ kind: "move", state: "downloading", received_bytes: 1e8, total_bytes: 4e8 });
    let { container } = await render(downloading);
    expect(container.textContent).toContain("Downloading the installer: 100 MB of 400 MB");
    document.body.innerHTML = "";
    ({ container } = await render(install({ kind: "move", state: "verifying" })));
    expect(container.textContent).toContain("Checking the installer...");
    document.body.innerHTML = "";
    ({ container } = await render(install({ kind: "move", state: "ready" })));
    await click(button(container, "Restart to finish moving"));
    expect(stubs.restart).toHaveBeenCalledWith(false);
  });

  it("asks first while a job runs", async () => {
    stubs.restartError.current = new ApiError(
      409,
      "/updates/restart/",
      "Conflict",
      { errors: [{ field: null, message: "A job is running (Scan Photos).", code: "job_running" }] },
      "A job is running (Scan Photos)."
    );
    const { container } = await render(install({ kind: "move", state: "ready" }));
    expect(container.textContent).toContain("A job is running (Scan Photos).");
    await click(button(container, "Restart anyway"));
    expect(stubs.restart).toHaveBeenCalledWith(true);
  });

  it("says why a move failed and offers it again", async () => {
    const { container } = await render(install({ kind: "move", state: "failed", error: "checksum_mismatch" }));
    expect(container.textContent).toContain("could not move to the installed version: the download was damaged");
    await click(button(container, "Try again"));
    expect(stubs.move).toHaveBeenCalledOnce();
  });

  it("says that it is moving while it restarts", async () => {
    const { container } = await render(install({ kind: "move", state: "restarting" }));
    expect(container.textContent).toContain("moving to the installed version. This page reloads");
  });

  it("keeps the update card from offering a download meanwhile", async () => {
    const { container } = await renderInMantine(
      <UpdateInstallPanel install={install({ kind: "move", state: "ready" })} latest="1.8.0" />
    );
    expect(container.textContent).toContain("Update it once that is done.");
    expect(container.querySelector("button")).toBeNull();
  });
});
