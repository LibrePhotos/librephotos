/**
 * A service the server was told not to run is not a fault, but the page used to
 * present it as one: the same red "Unhealthy" badge as a crashed sidecar, and a
 * Start button whose only answer was a 500. An admin who turned face detection
 * off then went looking for a breakage that was never there.
 *
 * Stop took effect for every user on one click (#2223); it asks first now.
 */
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { click, dialogButton, openDialog } from "../modals/confirmModal.test-utils";
import { ServiceList } from "./ServiceList";

type ServiceAction = { serviceName: string; action: "start" | "stop" };
const performAction = vi.fn<(action: ServiceAction, options?: { onSuccess?: () => void }) => void>();

// Like i18next without a bundle: the key.
const t = vi.fn((key: string) => key);

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t }),
}));

const health: Record<string, unknown> = {};
const healthQuery: { data: Record<string, unknown> | undefined } = { data: health };

vi.mock("../../api_client/api", () => ({
  queryClient: { invalidateQueries: () => {} },
}));

vi.mock("../../api_client/services/hooks/useServiceActionMutation", () => ({
  useServiceActionMutation: () => ({ mutate: performAction, isPending: false, variables: undefined }),
}));

vi.mock("../../api_client/services/hooks/useServicesQuery", () => ({
  useServicesListQuery: () => ({
    data: { services: { face_recognition: 8005, thumbnail: 8003 } },
    isLoading: false,
  }),
  useServicesHealthQuery: () => ({ data: healthQuery.data, isLoading: healthQuery.data === undefined }),
}));

// jsdom ships no matchMedia; MantineProvider needs it.
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

async function render() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MantineProvider env="test">
        <ServiceList />
      </MantineProvider>
    );
  });
  const unmount = async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  };
  return { container, unmount };
}

function startButtons(container: Element) {
  return [...container.querySelectorAll("button")].filter(button => button.textContent?.includes("services.start"));
}

/** The table row of the service labelled `label`. */
function serviceRow(container: Element, label: string) {
  const row = [...container.querySelectorAll("tbody tr")].find(tr => tr.textContent?.includes(label));
  if (!row) throw new Error(`no row for ${label}`);
  return row;
}

describe("ServiceList", () => {
  beforeEach(() => {
    t.mockClear();
    performAction.mockReset();
    healthQuery.data = health;
    health.face_recognition = {
      service_name: "face_recognition",
      healthy: false,
      enabled: false,
      feature_flag: "FEATURE_FACE_DETECTION",
    };
    health.thumbnail = { service_name: "thumbnail", healthy: false, enabled: true, feature_flag: null };
  });

  it("marks a switched-off service disabled rather than unhealthy", async () => {
    const { container, unmount } = await render();

    const row = serviceRow(container, "services.label_face_recognition");
    expect(row.textContent).toContain("services.disabled");
    expect(row.textContent).not.toContain("services.unhealthy");

    await unmount();
  });

  it("names the environment variable that switched the service off", async () => {
    const { unmount } = await render();

    expect(t).toHaveBeenCalledWith("services.disabled_by", { flag: "FEATURE_FACE_DETECTION" });

    await unmount();
  });

  it("offers no Start button for a switched-off service", async () => {
    // Starting one is a 409 the admin can do nothing about until they change
    // the server's environment.
    const { container, unmount } = await render();

    expect(startButtons(container)).toHaveLength(1);

    await unmount();
  });

  it("still reports a genuinely dead service as unhealthy and offers to start it", async () => {
    const { container, unmount } = await render();

    const row = serviceRow(container, "services.label_thumbnail");
    expect(row.textContent).toContain("services.unhealthy");
    expect(startButtons(row)).toHaveLength(1);

    await unmount();
  });

  it("says why a service that is down cannot start (#2324)", async () => {
    health.thumbnail = {
      service_name: "thumbnail",
      healthy: false,
      enabled: true,
      feature_flag: null,
      port_conflict: "port 8003 is used by python.exe (process ID 4321)",
    };

    const { container, unmount } = await render();

    const row = serviceRow(container, "services.label_thumbnail");
    expect(row.textContent).toContain("services.cannot_start");
    expect(t).toHaveBeenCalledWith("services.cannot_start", {
      reason: "port 8003 is used by python.exe (process ID 4321)",
    });
    expect(startButtons(row)).toHaveLength(1);

    await unmount();
  });

  it("shows no reason when the backend knows none", async () => {
    const { container, unmount } = await render();

    expect(container.textContent).not.toContain("services.cannot_start");

    await unmount();
  });

  it("offers no Start button while the health status is still loading", async () => {
    // Before the health check answers every service looks stopped, also the switched-off ones.
    healthQuery.data = undefined;

    const { container, unmount } = await render();

    expect(startButtons(container)).toHaveLength(0);

    await unmount();
  });

  it("gives the icon-only refresh button an accessible name", async () => {
    const { container, unmount } = await render();

    expect(container.querySelector('button[aria-label="services.refresh"]')).not.toBeNull();

    await unmount();
  });

  it("falls back to a generic explanation when no flag is named", async () => {
    health.face_recognition = {
      service_name: "face_recognition",
      healthy: false,
      enabled: false,
      feature_flag: null,
    };

    const { container, unmount } = await render();

    expect(container.textContent).toContain("services.disabled");
    expect(t).toHaveBeenCalledWith("services.disabled_hint");

    await unmount();
  });

  describe("Stop", () => {
    beforeEach(() => {
      health.thumbnail = { service_name: "thumbnail", healthy: true, enabled: true, feature_flag: null };
    });

    async function askToStop() {
      const rendered = await render();
      const stop = [...rendered.container.querySelectorAll("button")].find(button =>
        button.textContent?.includes("services.stop")
      );
      if (!stop) throw new Error("no Stop button");
      await click(stop);
      return rendered;
    }

    it("asks first, naming the service, and stops nothing yet", async () => {
      const { unmount } = await askToStop();

      expect(openDialog()?.textContent).toContain("confirmdialog.stopservice.title");
      expect(t).toHaveBeenCalledWith("confirmdialog.stopservice.title", { name: "services.label_thumbnail" });
      expect(performAction).not.toHaveBeenCalled();

      await unmount();
    });

    it("keeps the service running on Cancel", async () => {
      const { unmount } = await askToStop();

      await click(dialogButton("cancel"));

      expect(performAction).not.toHaveBeenCalled();
      await unmount();
    });

    it("stops the service once confirmed", async () => {
      const { unmount } = await askToStop();

      await click(dialogButton("confirmdialog.stopservice.confirm"));

      expect(performAction).toHaveBeenCalledWith({ serviceName: "thumbnail", action: "stop" }, expect.anything());
      await unmount();
    });
  });
});
