/** #2037: Scan now next to a user's folder in the Admin Area, and its progress while it runs. */
import type { JobDetail } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { ScanUserButton } from "./ScanUserButton";

const stubs = vi.hoisted(() => ({
  scan: vi.fn<(variables: { userId: number; username: string }) => void>(),
  running: null as JobDetail | null,
}));

vi.mock("../../api_client/jobs/hooks/useScanUserPhotosMutation", () => ({
  useScanUserPhotosMutation: () => ({ mutate: stubs.scan, isPending: false }),
}));
vi.mock("../../hooks/useWorkerStatus", () => ({
  useWorkerStatus: () => ({ workerRunningJob: stubs.running }),
}));

const job = (overrides: Partial<JobDetail> = {}): JobDetail => ({
  id: 7,
  job_id: "abc",
  queued_at: "2026-10-10T10:00:00Z",
  finished: false,
  finished_at: null,
  started_at: "2026-10-10T10:00:01Z",
  failed: false,
  cancelled: false,
  job_type_str: "Scan Photos",
  job_type: 1,
  started_by: { id: 3, username: "sam", first_name: "", last_name: "" },
  progress_target: 200,
  progress_current: 68,
  ...overrides,
});

let root: Root;
let container: HTMLDivElement;

const render = async () => {
  await act(async () => {
    root.render(
      <MantineProvider env="test">
        <ScanUserButton userId={3} username="sam" />
      </MantineProvider>
    );
  });
};

beforeAll(async () => {
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
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  stubs.scan.mockClear();
  stubs.running = null;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("ScanUserButton", () => {
  it("starts the scan of that user, named for screen readers", async () => {
    await render();
    const button = container.querySelector("button");
    expect(button?.getAttribute("aria-label")).toBe("Scan sam's photos now");

    await act(async () => button?.click());

    expect(stubs.scan).toHaveBeenCalledWith({ userId: 3, username: "sam" });
  });

  it("shows the progress of that user's running scan instead", async () => {
    stubs.running = job();
    await render();

    expect(container.querySelector("button")).toBeNull();
    expect(container.querySelector(".mantine-Badge-label")?.textContent).toBe("Scanning 34 %");
  });

  it("says scanning before the scan knows how much there is", async () => {
    stubs.running = job({ progress_target: 0, progress_current: 0 });
    await render();

    expect(container.querySelector(".mantine-Badge-label")?.textContent).toBe("Scanning");
  });

  it("keeps the button while another user's scan or another job runs", async () => {
    stubs.running = job({ started_by: { id: 4, username: "mira", first_name: "", last_name: "" } });
    await render();
    expect(container.querySelector("button")).not.toBeNull();

    stubs.running = job({ job_type: 18 });
    await render();
    expect(container.querySelector("button")).not.toBeNull();
  });
});
