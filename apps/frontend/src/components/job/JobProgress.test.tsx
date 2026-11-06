/**
 * A scan that hit an I/O error on a few files reports status "partial_failure"
 * and still sets result.error (issue #167). The finished state used to go red on
 * any result.error, which painted a 4-in-150k scan as "Failed"; these pin the
 * finished states apart. The words for each state are the status chip's.
 */
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { JobProgress } from "./JobProgress";

vi.mock("react-i18next", async importOriginal => {
  const actual = await importOriginal<typeof import("react-i18next")>();
  return {
    ...actual,
    // The real i18n instance, which the percentage takes the UI language from, with a t that shows the key
    useTranslation: () => ({
      ...actual.useTranslation(),
      t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key} ${Object.values(vars).join("/")}` : key),
    }),
  };
});

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: query.includes("min-width"),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
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

function barColor(container: HTMLElement) {
  return container.querySelector(".mantine-Progress-section")?.getAttribute("style") ?? "";
}

function barLabel(container: HTMLElement) {
  return container.querySelector(".mantine-Progress-section")?.getAttribute("aria-label") ?? "";
}

// Only a running job's bar is the primary colour and a hard failure's red: a finished one is a thin
// dimmed line, and how it ended is said by its status (JobStatusChip), not a green or orange bar.
describe("JobProgress finished states", () => {
  it("renders a clean scan as a dimmed line with the item count", async () => {
    const { container, unmount } = await render(
      <JobProgress finished target={150000} current={150000} failed={false} result={{}} />
    );

    expect(barColor(container)).toContain("gray");
    expect(barColor(container)).not.toContain("blue");
    expect(barColor(container)).not.toContain("green");
    expect(container.textContent).toContain("150,000 / 150,000");
    expect(barLabel(container)).toBe("joblist.itemsprocessed 150000");
    await unmount();
  });

  it("renders a mostly-successful scan like a clean one, not orange or red", async () => {
    const { container, unmount } = await render(
      <JobProgress
        finished
        target={150000}
        current={150000}
        failed={false}
        result={{
          status: "partial_failure",
          error_count: 4,
          error: "/data/a.jpg: [Errno 116] Stale file handle",
          errors: ["/data/a.jpg: [Errno 116] Stale file handle"],
        }}
      />
    );

    expect(barColor(container)).toContain("gray");
    expect(barColor(container)).not.toContain("orange");
    expect(barColor(container)).not.toContain("red");
    await unmount();
  });

  it("renders a hard failure red", async () => {
    const { container, unmount } = await render(
      <JobProgress
        finished
        target={10}
        current={10}
        failed
        result={{ status: "failed", error: "queue down", error_count: 10 }}
      />
    );

    expect(barColor(container)).toContain("red");
    await unmount();
  });

  it("renders a cancelled job grey with how far it got, not as a success", async () => {
    // LongRunningJob.cancel() sets finished and cancelled but not failed.
    const { container, unmount } = await render(
      <JobProgress finished cancelled target={100} current={40} failed={false} result={{ status: "cancelled" }} />
    );

    expect(barColor(container)).toContain("gray");
    expect(barColor(container)).toContain("40%");
    expect(container.textContent).toContain("40 / 100");
    await unmount();
  });

  it("still goes red when only result.status says failed", async () => {
    const { container, unmount } = await render(
      <JobProgress finished target={10} current={10} failed={false} result={{ status: "failed", error: "boom" }} />
    );

    expect(barColor(container)).toContain("red");
    await unmount();
  });
});

// #2201: the running percentage used toFixed, so it always had an English decimal point.
describe("JobProgress while running", () => {
  afterEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("counts against the target and says the percentage in one sentence", async () => {
    await i18n.changeLanguage("en");
    const { container, unmount } = await render(<JobProgress finished={false} target={1000} current={123} />);

    expect(container.textContent).toContain("123 / 1,000");
    expect(barLabel(container)).toBe("joblist.itemsprocessedpercent 123/12.3%");
    await unmount();
  });

  it("writes the numbers the UI language's way", async () => {
    await i18n.changeLanguage("de");
    const { container, unmount } = await render(<JobProgress finished={false} target={1000} current={123} />);

    expect(container.textContent).toContain("123 / 1.000");
    expect(barLabel(container).replace(/\s/g, " ")).toBe("joblist.itemsprocessedpercent 123/12,3 %");
    await unmount();
  });

  it("shows the job's own step under the bar when it reports one", async () => {
    const { container, unmount } = await render(
      <JobProgress finished={false} target={1000} current={123} progressStep="Extracting faces" />
    );

    expect(container.textContent).toContain("Extracting faces");
    await unmount();
  });
});
