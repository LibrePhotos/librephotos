/**
 * A service the server was told not to run is not a fault, but the page used to
 * present it as one: the same red "Unhealthy" badge as a crashed sidecar, and a
 * Start button whose only answer was a 500. An admin who turned face detection
 * off then went looking for a breakage that was never there.
 */
import { MantineProvider } from "@mantine/core";
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceList } from "./ServiceList";

const t = vi.fn((key: string) => key);

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t }),
}));

const health: Record<string, unknown> = {};

vi.mock("../../api_client/api", () => ({
  queryClient: { invalidateQueries: vi.fn() },
}));

vi.mock("../../api_client/services/hooks/useServiceActionMutation", () => ({
  useServiceActionMutation: () => ({ mutate: vi.fn(), isPending: false, variables: undefined }),
}));

vi.mock("../../api_client/services/hooks/useServicesQuery", () => ({
  ServiceHealthQueryKeys: ["serviceHealth"],
  useServicesListQuery: () => ({
    data: { services: { face_recognition: 8005, thumbnail: 8003 } },
    isLoading: false,
  }),
  useServicesHealthQuery: () => ({ data: health, isLoading: false }),
}));

// jsdom ships no matchMedia; MantineProvider needs it.
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

async function render() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MantineProvider>
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

function startButtons(container: HTMLElement) {
  return [...container.querySelectorAll("button")].filter(button => button.textContent?.includes("services.start"));
}

describe("ServiceList", () => {
  beforeEach(() => {
    t.mockClear();
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

    const row = [...container.querySelectorAll("tbody tr")].find(tr => tr.textContent?.includes("Face Recognition"))!;
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

    const row = [...container.querySelectorAll("tbody tr")].find(tr => tr.textContent?.includes("Thumbnail"))!;
    expect(row.textContent).toContain("services.unhealthy");
    expect(startButtons(row as HTMLElement)).toHaveLength(1);

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
});
