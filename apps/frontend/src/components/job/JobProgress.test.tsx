/**
 * A scan that hit an I/O error on a few files reports status "partial_failure"
 * and still sets result.error (issue #167). The finished state used to go red on
 * any result.error, which painted a 4-in-150k scan as "Failed"; these pin the
 * three distinct finished states apart.
 */
import { MantineProvider } from "@mantine/core";
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { JobProgress } from "./JobProgress";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key} ${Object.values(vars).join("/")}` : key),
  }),
}));

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = (query: string) =>
    ({
      matches: query.includes("min-width"),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
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

describe("JobProgress finished states", () => {
  it("renders a clean scan green with the item count", async () => {
    const { container, unmount } = await render(
      <JobProgress finished target={150000} current={150000} failed={false} result={{}} />
    );

    expect(barColor(container)).toContain("green");
    expect(container.textContent).toContain("joblist.itemsadded");
    expect(container.textContent).not.toContain("joblist.failed");
    await unmount();
  });

  it("renders a mostly-successful scan amber, not red", async () => {
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

    expect(barColor(container)).toContain("yellow");
    expect(barColor(container)).not.toContain("red");
    // errorCount out of progress_target, so the user can see how small it is.
    expect(container.textContent).toContain("joblist.partialfailure 4/150000");
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
    expect(container.textContent).toContain("joblist.failed");
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
