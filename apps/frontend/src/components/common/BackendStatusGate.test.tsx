/**
 * BackendStatusGate (#2310): a request that cannot reach the server (no answer, a proxy's 502-504)
 * makes the gate ask the readiness probe; while that is not 200 the page is replaced by one status
 * screen whose text follows the probe's answer (updating, starting, not answering, or a failed
 * update by its reason code). It checks every 5 s, and when the server serves again the page comes
 * back with fresh data. A 500 or a 401 never shows it, and neither does a lone 504 the probe
 * contradicts.
 */
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api_client/apiError";
import { clearBackendTrouble, reportRequestFailure } from "../../api_client/server/backendTrouble";
import i18n from "../../i18n";
import { BackendStatusGate } from "./BackendStatusGate";

const stubs = vi.hoisted(() => ({
  get: vi.fn<(endpoint: string) => Promise<unknown>>(),
  backendBack: vi.fn<() => void>(),
}));

vi.mock("../../api_client/api", async importOriginal => ({
  ...(await importOriginal<typeof import("../../api_client/api")>()),
  apiClient: { get: (endpoint: string) => stubs.get(endpoint) },
}));
vi.mock("../../service/notifications", () => ({
  notification: new Proxy({}, { get: (_target, name) => (name === "backendBack" ? stubs.backendBack : () => {}) }),
}));

const HEALTHY = { status: "ok", checks: { postgresql: { status: "ok" }, queue: { status: "ok" } } };
const startup = (body: unknown) => new ApiError("Service Unavailable", 503, null, "/healthz/ready/", body);

let root: Root;
let container: HTMLDivElement;
let queryClient: QueryClient;

/** Lets the probe's promise and the timers due by now run. */
const flush = () => act(() => vi.advanceTimersByTimeAsync(0));

async function render() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  queryClient = new QueryClient();
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <MantineProvider>
          <BackendStatusGate>
            <p>The timeline</p>
          </BackendStatusGate>
        </MantineProvider>
      </QueryClientProvider>
    );
  });
}

/** A request failed to reach the server; the gate asks the probe. */
async function requestFails(error: unknown = new TypeError("Failed to fetch")) {
  await act(async () => reportRequestFailure(error));
  await flush();
}

const heading = () => container.ownerDocument.querySelector("h2")?.textContent ?? null;
const page = () => container.querySelector("p");

beforeAll(async () => {
  // jsdom has no matchMedia, MantineProvider needs it
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
  vi.useFakeTimers();
  stubs.get.mockReset();
  stubs.backendBack.mockReset();
  document.title = "LibrePhotos";
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  clearBackendTrouble();
  vi.useRealTimers();
});

describe("BackendStatusGate", () => {
  it("shows the page while the server answers", async () => {
    await render();

    expect(page()?.textContent).toBe("The timeline");
    expect(heading()).toBeNull();
    expect(stubs.get).not.toHaveBeenCalled();
  });

  it("takes over when a request gets no answer and the probe gets none either", async () => {
    stubs.get.mockRejectedValue(new TypeError("Failed to fetch"));
    await render();

    await requestFails();

    expect(stubs.get).toHaveBeenCalledWith("/healthz/ready/");
    expect(heading()).toBe("LibrePhotos is not answering");
    // The page stays mounted under the screen, out of reach.
    expect(page()?.closest("[inert]")).not.toBeNull();
    expect(document.title).toBe("Not answering · LibrePhotos");
    expect(container.ownerDocument.activeElement?.textContent).toBe("LibrePhotos is not answering");
  });

  it.each([
    [{ status: "updating" }, "LibrePhotos is updating", "Updating · LibrePhotos"],
    [{ status: "starting" }, "LibrePhotos is starting", "Starting · LibrePhotos"],
    // Today's server, with its database down: no phase to name.
    [{ status: "error", checks: {} }, "LibrePhotos is not answering", "Not answering · LibrePhotos"],
  ])("names what the server's 503 says (%j)", async (body, title, tab) => {
    stubs.get.mockRejectedValue(startup(body));
    await render();

    await requestFails(new ApiError("Bad Gateway", 502));

    expect(heading()).toBe(title);
    expect(document.title).toBe(tab);
    expect(container.ownerDocument.querySelector("[role=status]")).not.toBeNull();
  });

  it.each([
    ["E001", "This LibrePhotos is too old to update in one step", "#old-releases"],
    ["E002", "This database belongs to a newer LibrePhotos", "#downgrade"],
    ["E999", "The update could not finish", "#updating-screen"],
    [undefined, "The update could not finish", "#updating-screen"],
  ])("explains a failed update with reason code %s", async (reasonCode, title, anchor) => {
    stubs.get.mockRejectedValue(startup({ status: "failed", reason_code: reasonCode }));
    await render();

    await requestFails();

    const doc = container.ownerDocument;
    expect(heading()).toBe(title);
    expect(doc.querySelector("[role=alert]")).not.toBeNull();
    expect(doc.title).toBe("Update failed · LibrePhotos");
    const guide = [...doc.querySelectorAll("a")].find(link => link.textContent === "Open the upgrade guide");
    expect(guide?.getAttribute("href")).toBe(`https://docs.librephotos.com/docs/installation/upgrading${anchor}`);
  });

  it("copies a short support text: state, reason code, version, time", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());
    vi.stubGlobal("isSecureContext", true);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    stubs.get.mockRejectedValue(startup({ status: "failed", reason_code: "E002", version: "1.4.0" }));
    await render();
    await requestFails();

    const copy = [...container.ownerDocument.querySelectorAll("button")].find(
      button => button.textContent === "Copy details"
    );
    await act(async () => copy?.click());
    vi.unstubAllGlobals();

    const text = writeText.mock.calls[0]?.[0] ?? "";
    expect(text).toContain("LibrePhotos status: failed");
    expect(text).toContain("Reason code: E002");
    expect(text).toContain("Version: 1.4.0");
    expect(text).toMatch(/Time: \d{4}-\d\d-\d\dT/);
  });

  it("checks every 5 s and gives the page back, refreshed, when the server serves again", async () => {
    stubs.get.mockRejectedValue(startup({ status: "updating" }));
    await render();
    await requestFails();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    expect(stubs.get).toHaveBeenCalledTimes(1);

    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(stubs.get).toHaveBeenCalledTimes(2);
    expect(heading()).toBe("LibrePhotos is updating");
    expect(container.ownerDocument.body.textContent).toContain("Updating for 5 seconds");

    stubs.get.mockResolvedValue(HEALTHY);
    await act(() => vi.advanceTimersByTimeAsync(5000));

    expect(heading()).toBeNull();
    expect(page()?.closest("[inert]")).toBeNull();
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(stubs.backendBack).toHaveBeenCalledTimes(1);
    expect(document.title).toBe("LibrePhotos");
  });

  it("asks again at once on Check now", async () => {
    stubs.get.mockRejectedValue(new TypeError("Failed to fetch"));
    await render();
    await requestFails();
    stubs.get.mockResolvedValue(HEALTHY);

    const checkNow = [...container.ownerDocument.querySelectorAll("button")].find(
      button => button.textContent === "Check now"
    );
    await act(async () => checkNow?.click());
    await flush();

    expect(stubs.get).toHaveBeenCalledTimes(2);
    expect(heading()).toBeNull();
  });

  it("adds a hint after 15 minutes of updating", async () => {
    stubs.get.mockRejectedValue(startup({ status: "updating" }));
    await render();
    await requestFails();
    expect(container.ownerDocument.body.textContent).not.toContain("Still working?");

    await act(() => vi.advanceTimersByTimeAsync(15 * 60 * 1000));

    expect(container.ownerDocument.body.textContent).toContain("Still working?");
  });

  it("stays out of the way of a lone 504 when the probe says the server is fine", async () => {
    stubs.get.mockResolvedValue(HEALTHY);
    await render();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    await requestFails(new ApiError("Gateway Timeout", 504));

    expect(stubs.get).toHaveBeenCalledTimes(1);
    expect(heading()).toBeNull();
    expect(invalidate).not.toHaveBeenCalled();
    expect(stubs.backendBack).not.toHaveBeenCalled();
  });

  it.each([
    ["a 500", new ApiError("Internal Server Error", 500)],
    ["a 401", new ApiError("Authentication failed", 401)],
    ["a refused change", new ApiError("Bad Request", 400)],
  ])("never asks the probe after %s", async (_name, error) => {
    await render();

    await requestFails(error);

    expect(stubs.get).not.toHaveBeenCalled();
    expect(heading()).toBeNull();
  });
});
