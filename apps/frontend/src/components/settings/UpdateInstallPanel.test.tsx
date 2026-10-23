/**
 * #2788: the Windows app updates itself from the Update available card. Download update, its
 * progress, Restart to update (asking first while a job runs), and a failure that says why.
 */
import { ApiError, type InstallState } from "@librephotos/api-client";
import React from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { click, renderInMantine, setUpMantineDom } from "../modals/confirmModal.test-utils";
import { UpdateInstallPanel } from "./UpdateInstallPanel";

const stubs = vi.hoisted(() => ({
  download: vi.fn<(version: string) => void>(),
  restart: vi.fn<(force: boolean) => void>(),
  restartError: { current: null as Error | null },
}));

vi.mock("../../api_client/server", () => ({
  useInstallUpdateMutation: () => ({ mutate: stubs.download, isPending: false }),
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
    ...overrides,
  };
}

function button(container: HTMLElement, label: string): HTMLButtonElement {
  return defined(
    [...container.querySelectorAll("button")].find(candidate => candidate.textContent === label),
    `the ${label} button`
  );
}

/** A 409 in the server's error envelope. */
function refusal(code: string, message: string): ApiError {
  return new ApiError(409, "/updates/restart/", "Conflict", { errors: [{ field: null, message, code }] }, message);
}

async function render(state: InstallState) {
  return renderInMantine(<UpdateInstallPanel install={state} latest="1.5.0" />);
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

describe("UpdateInstallPanel", () => {
  it("downloads the newest release and says how it is checked", async () => {
    const { container } = await render(install());
    await click(button(container, "Download update"));
    expect(stubs.download).toHaveBeenCalledWith("1.5.0");
    expect(container.textContent).toContain("checks it against the release's SHA-256 checksums");
  });

  it("shows the download's progress, then checking and unpacking", async () => {
    const downloading = install({ state: "downloading", version: "1.5.0", received_bytes: 21e7, total_bytes: 45e7 });
    let { container } = await render(downloading);
    expect(container.textContent).toContain("Downloading 1.5.0: 210 MB of 450 MB");
    expect(container.querySelector("[role=progressbar]")?.getAttribute("aria-valuenow")).toBe("47");
    document.body.innerHTML = "";
    ({ container } = await render(install({ state: "downloading", version: "1.5.0", received_bytes: 1e6 })));
    expect(container.textContent).toContain("Downloading 1.5.0: 1 MB");
    document.body.innerHTML = "";
    ({ container } = await render(install({ state: "verifying", version: "1.5.0" })));
    expect(container.textContent).toContain("Checking the download...");
    document.body.innerHTML = "";
    ({ container } = await render(install({ state: "extracting", version: "1.5.0" })));
    expect(container.textContent).toContain("Unpacking 1.5.0...");
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });

  it("says why a download failed and offers it again", async () => {
    const { container } = await render(install({ state: "failed", version: "1.5.0", error: "disk_full" }));
    expect(container.textContent).toContain(
      "The update could not be installed: there is not enough free disk space next to the program folder."
    );
    await click(button(container, "Try again"));
    expect(stubs.download).toHaveBeenCalledWith("1.5.0");
    document.body.innerHTML = "";
    const unknown = await render(install({ state: "failed", error: "http_500" }));
    expect(unknown.container.textContent).toContain("something went wrong (http_500)");
  });

  it("restarts into a ready update", async () => {
    const { container } = await render(install({ state: "ready", version: "1.5.0" }));
    expect(container.textContent).toContain("1.5.0 is downloaded and checked.");
    expect(container.textContent).toContain("librephotos-old");
    await click(button(container, "Restart to update"));
    expect(stubs.restart).toHaveBeenCalledWith(false);
  });

  it("asks before stopping a running job", async () => {
    stubs.restartError.current = refusal("job_running", "A job is running (Scan Photos). Restarting stops it.");
    const { container } = await render(install({ state: "ready", version: "1.5.0" }));
    expect(container.textContent).toContain("A job is running (Scan Photos). Restarting stops it.");
    await click(button(container, "Restart anyway"));
    expect(stubs.restart).toHaveBeenCalledWith(true);
  });

  it("says when a restart failed", async () => {
    stubs.restartError.current = refusal("update_not_ready", "Not ready.");
    let { container } = await render(install({ state: "ready", version: "1.5.0", error: "restart_failed" }));
    expect(container.textContent).toContain("Not ready.");
    expect(container.textContent).toContain("LibrePhotos could not start the new release.");
    document.body.innerHTML = "";
    stubs.restartError.current = new TypeError("Failed to fetch");
    ({ container } = await render(install({ state: "ready", version: "1.5.0" })));
    expect(container.textContent).toContain("LibrePhotos could not start the new release.");
  });

  it("waits while LibrePhotos restarts", async () => {
    const { container } = await render(install({ state: "restarting", version: "1.5.0" }));
    expect(container.textContent).toContain("LibrePhotos is restarting to update to 1.5.0.");
  });
});
