/**
 * #2741: nothing told a user how far the processing of their library got. The Library page now has
 * a Processing status card: one row per stage that is on, what is left, Run now.
 */
import type { ProcessingStage, ProcessingStageKey, ProcessingStatus } from "@librephotos/api-client";
import React from "react";
import type { ReactNode } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { expectDisabledWithReason } from "../common/disabledReason.test-utils";
import { click, renderInMantine, setUpMantineDom } from "../modals/confirmModal.test-utils";
import { ProcessingStatusCard } from "./ProcessingStatusCard";

type QueryStub = {
  data: ProcessingStatus | undefined;
  isError: boolean;
  isFetching: boolean;
  refetch: () => Promise<unknown>;
};

const stubs = vi.hoisted(() => ({
  run: vi.fn<(stage: ProcessingStageKey) => void>(),
  refetch: vi.fn<() => Promise<unknown>>(),
  busy: false,
  query: { data: undefined, isError: false, isFetching: false } as Omit<QueryStub, "refetch">,
}));

vi.mock("../../api_client/jobs/hooks", () => ({
  useProcessingStatusQuery: (): QueryStub => ({ ...stubs.query, refetch: stubs.refetch }),
  useRunProcessingStageMutation: () => ({ mutate: stubs.run, isPending: false, variables: undefined }),
}));
vi.mock("../../hooks/useJobQueue", () => ({ useJobQueue: () => ({ busy: stubs.busy, job: null }) }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, ...rest }: { to: string; children?: ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

function stage(key: string, overrides: Partial<ProcessingStage> = {}): ProcessingStage {
  return { key, remaining: 0, running_job: null, last_run: null, ...overrides };
}

function status(stages: ProcessingStage[], photoCount = 48212): ProcessingStatus {
  return { photo_count: photoCount, stages };
}

async function renderCard(data: ProcessingStatus | undefined, uploadOnly = false) {
  stubs.query = { ...stubs.query, data };
  const { container } = await renderInMantine(<ProcessingStatusCard uploadOnly={uploadOnly} />);
  return container;
}

function row(container: HTMLElement, title: string): HTMLLIElement {
  return defined(
    [...container.querySelectorAll("li")].find(candidate => candidate.textContent?.startsWith(title)),
    `the ${title} row`
  );
}

beforeAll(async () => {
  setUpMantineDom();
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  document.body.innerHTML = "";
  stubs.run.mockReset();
  stubs.refetch.mockReset();
  stubs.busy = false;
  stubs.query = { data: undefined, isError: false, isFetching: false };
});

describe("ProcessingStatusCard", () => {
  it("lists each stage with what is left and how many stages are done", async () => {
    const container = await renderCard(
      status([
        stage("thumbnails", { remaining: 3 }),
        stage("search", { remaining: 1204 }),
        stage("face_detection", { remaining: 2410 }),
        stage("face_recognition", { remaining: 1 }),
        stage("captions"),
      ])
    );

    expect(container.querySelector("h4")?.textContent).toBe("Processing status");
    expect(container.textContent).toContain("1 of 5 stages done");
    expect(container.textContent).toContain("your 48,212 photos");
    expect(row(container, "Thumbnails").textContent).toContain("3 missing");
    expect(row(container, "Search").textContent).toContain("1,204 missing");
    expect(row(container, "Face detection").textContent).toContain("2,410 not checked");
    expect(row(container, "Face recognition data").textContent).toContain("1 face");
    const captions = row(container, "Captions");
    expect(captions.textContent).toContain("Done");
    expect(captions.querySelector("button")).toBeNull();
  });

  it("starts a stage's job with Run now, named after the stage", async () => {
    const container = await renderCard(status([stage("places", { remaining: 86 })]));
    const button = defined(row(container, "Places").querySelector("button"));

    expect(button.getAttribute("aria-label")).toBe("Run now: Places");
    await click(button);
    expect(stubs.run).toHaveBeenCalledWith("places");
  });

  it("shows a running stage's progress and a link to the job list instead of Run now", async () => {
    const running = { job_id: "j1", progress_current: 540, progress_target: 1204 };
    const container = await renderCard(status([stage("things", { remaining: 664, running_job: running })]));
    const things = row(container, "Things");

    expect(things.textContent).toContain("Running · 540 of 1,204");
    expect(things.querySelector("[role=progressbar]")?.getAttribute("aria-valuetext")).toBe("540 of 1,204");
    expect(things.querySelector("button")).toBeNull();
    expect(things.querySelector("a")?.textContent).toBe("View job");
  });

  it("says a queued stage is starting", async () => {
    const queued = { job_id: "j1", progress_current: 0, progress_target: 0 };
    const container = await renderCard(status([stage("text", { remaining: 9, running_job: queued })]));

    expect(row(container, "Text in photos").textContent).toContain("Starting");
  });

  it("links the failures of the last run to the job list", async () => {
    const lastRun = { job_id: "j2", finished_at: null, failed: false, error_count: 12 };
    const failedRun = { ...lastRun, failed: true, error_count: 0 };
    const container = await renderCard(
      status([
        stage("text", { remaining: 9882, last_run: lastRun }),
        stage("places", { remaining: 4, last_run: failedRun }),
        stage("search", { remaining: 0, last_run: { ...lastRun, error_count: 0 } }),
      ])
    );

    const failures = row(container, "Text in photos").querySelector("a");
    expect(failures?.textContent).toBe("12 failed in the last run");
    expect(failures?.getAttribute("href")).toBe("/jobs");
    expect(row(container, "Places").textContent).toContain("The last run failed");
    expect(row(container, "Search").querySelector("a")).toBeNull();
  });

  it("says why Run now waits while a job runs", async () => {
    const reason = "A job is running. Start this one when it has finished.";
    stubs.query = { ...stubs.query, data: status([stage("places", { remaining: 86 })]) };
    const { container } = await renderInMantine(<ProcessingStatusCard busyReason={reason} uploadOnly={false} />);
    const button = defined(row(container, "Places").querySelector("button"));

    expectDisabledWithReason(button, reason);
    await click(button);
    expect(stubs.run).not.toHaveBeenCalled();
  });

  it("collapses to one green line when every stage is done, and opens on Show details", async () => {
    const container = await renderCard(status([stage("thumbnails"), stage("search")]));

    expect(container.textContent).toContain("All 48,212 photos are processed");
    expect(container.querySelector("li")).toBeNull();
    const show = defined([...container.querySelectorAll("button")].find(b => b.textContent === "Show details"));
    await click(show);
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.textContent).toContain("Hide details");
  });

  it("explains older uploads on the face detection row of an upload-only library", async () => {
    const container = await renderCard(status([stage("face_detection", { remaining: 612 })]), true);

    expect(row(container, "Face detection").textContent).toContain("Includes older uploads with no faces");
  });

  it("leaves out a stage this app does not know", async () => {
    const container = await renderCard(status([stage("music", { remaining: 5 }), stage("search", { remaining: 2 })]));

    expect(container.querySelectorAll("li")).toHaveLength(1);
    expect(container.textContent).toContain("0 of 1 stages done");
  });

  it("shows nothing for a library without photos", async () => {
    const container = await renderCard(status([stage("search")], 0));

    expect(container.querySelector("section")).toBeNull();
  });

  it("offers a retry when the status cannot be read", async () => {
    stubs.query = { data: undefined, isError: true, isFetching: false };
    const { container } = await renderInMantine(<ProcessingStatusCard uploadOnly={false} />);

    expect(container.querySelector("[role=alert]")).not.toBeNull();
    expect(container.textContent).toContain("Processing status");
  });

  it("shows a loader before the first answer", async () => {
    const container = await renderCard(undefined);

    expect(container.querySelector("[role=status]")).not.toBeNull();
  });
});
