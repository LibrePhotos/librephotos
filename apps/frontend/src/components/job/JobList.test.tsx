/**
 * `JobList` is rendered on two surfaces: the admin area (all users' jobs) and a
 * regular user's own job list at /jobs (issue #1909). The backend already scopes
 * /api/jobs/ to the requesting user for non-staff, so the component is shared —
 * which makes the surface-specific bits the thing worth pinning down:
 *
 *   - the row link must follow the surface it is rendered on. Hardcoding the admin
 *     detail route would send a regular user to /admin/job/<id>, an admin-area URL
 *     whose page renders "Unauthorized" for them.
 *   - "Started By" is every row's own viewer on the per-user list, so it is dropped
 *     there and must stay on the admin list.
 *   - on a phone every row must have as many cells as the header. A stray
 *     "waiting" Duration cell used to shift Cancel and Remove one column right,
 *     where the card clipped them.
 */
import { MantineProvider } from "@mantine/core";
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { useCancelJobMutation, useDeleteJobMutation } from "../../api_client/jobs/hooks";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { JobList } from "./JobList";

// The row links JobList navigates to
const navigate = vi.fn<(options: { to: string }) => void>();
// Records the arguments the list queries with
const useJobsQuery = vi.fn<(...args: unknown[]) => void>();

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
}));

const job = {
  id: 42,
  job_id: "b7b0e0f2-0000-4000-8000-000000000000",
  queued_at: "2026-07-20T10:00:00Z",
  started_at: "2026-07-20T10:00:05Z",
  finished_at: "2026-07-20T10:01:00Z",
  finished: true,
  failed: false,
  cancelled: false,
  job_type_str: "Scan Photos",
  job_type: 1,
  progress_current: 10,
  progress_target: 10,
  progress_step: null,
  result: {},
  error: null,
  started_by: { id: 3, username: "dotan", first_name: "", last_name: "" },
};

const jobsData: { results: (typeof job)[] } = { results: [job] };

vi.mock("../../api_client/jobs/hooks", () => ({
  useJobsQuery: (...args: unknown[]) => {
    useJobsQuery(...args);
    return { data: { count: jobsData.results.length, results: jobsData.results }, isLoading: false };
  },
  useCancelJobMutation: () => ({
    mutate: vi.fn<ReturnType<typeof useCancelJobMutation>["mutate"]>(),
    isPending: false,
  }),
  useDeleteJobMutation: () => ({
    mutate: vi.fn<ReturnType<typeof useDeleteJobMutation>["mutate"]>(),
    isPending: false,
  }),
}));

// jsdom ships no matchMedia; MantineProvider and useMediaQuery both need it.
// Reporting a wide viewport keeps the desktop-only columns (incl. Started By) in.
function mockViewport(wide: boolean) {
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: wide && query.includes("min-width"),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

async function render(element: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<MantineProvider>{element}</MantineProvider>);
  });
  const unmount = async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  };
  return { container, unmount };
}

async function clickFirstRow(container: HTMLElement) {
  await act(async () => {
    defined(container.querySelector("tbody tr")).dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("JobList", () => {
  beforeEach(() => {
    navigate.mockClear();
    useJobsQuery.mockClear();
    mockViewport(true);
  });

  afterEach(() => {
    jobsData.results = [job];
  });

  it("sends the admin surface to the admin job detail route", async () => {
    const { container, unmount } = await render(<JobList />);

    await clickFirstRow(container);

    expect(navigate).toHaveBeenCalledWith({ to: "/admin/job/42" });
    await unmount();
  });

  it("keeps a row on its own surface instead of the admin area", async () => {
    const { container, unmount } = await render(<JobList variant="mine" />);

    await clickFirstRow(container);

    expect(navigate).toHaveBeenCalledWith({ to: "/jobs/42" });
    await unmount();
  });

  it("shows Started By on the admin list and drops it on a single-user list", async () => {
    const admin = await render(<JobList />);
    expect(admin.container.textContent).toContain("dotan");
    await admin.unmount();

    const mine = await render(<JobList variant="mine" />);
    expect(mine.container.textContent).not.toContain("dotan");
    await mine.unmount();
  });

  it("asks the backend to narrow the list only on the per-user surface", async () => {
    // Without this the page would show an admin every user's jobs — under a "My
    // Jobs" heading, with the owner column hidden.
    const mine = await render(<JobList variant="mine" />);
    expect(useJobsQuery).toHaveBeenCalledWith(expect.objectContaining({ mine: true }), expect.anything());
    await mine.unmount();

    useJobsQuery.mockClear();
    const admin = await render(<JobList />);
    expect(useJobsQuery).toHaveBeenCalledWith(expect.objectContaining({ mine: false }), expect.anything());
    await admin.unmount();
  });

  it.each(["admin", "mine"] as const)("keeps the %s list's cells under their headers on a phone", async variant => {
    mockViewport(false);
    const { container, unmount } = await render(<JobList variant={variant} />);

    const headers = container.querySelectorAll("thead th").length;
    expect(headers).toBe(4);
    expect(defined(container.querySelector("tbody tr")).querySelectorAll("td")).toHaveLength(headers);
    // The finished job is not waiting for anything.
    expect(container.textContent).not.toContain(i18n.t("joblist.waiting"));
    await unmount();
  });

  it("says so when there are no jobs instead of showing bare headers", async () => {
    jobsData.results = [];
    const { container, unmount } = await render(<JobList variant="mine" />);

    expect(container.textContent).toContain(i18n.t("joblist.empty"));
    await unmount();
  });
});
