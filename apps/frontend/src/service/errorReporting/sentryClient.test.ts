/**
 * #2938: the Sentry browser SDK as the web app sets it up. An error becomes one envelope that goes
 * to this server's forwarder, never to a reporting server: no fetch leaves the page.
 */
import { flush } from "@sentry/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => ({
  forward: vi.fn<(envelope: string) => Promise<boolean>>(async () => true),
}));

vi.mock("../../api_client/errorReports/forwardBrowserError", () => ({ forwardBrowserError: stubs.forward }));

const fetchSpy = vi.fn<typeof fetch>(async () => new Response(null, { status: 599 }));

beforeAll(() => {
  vi.stubGlobal("fetch", fetchSpy);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("sentryClient", () => {
  it("hands the error's envelope to the forwarder and fetches nothing itself", async () => {
    const { capture } = await import("./sentryClient");
    capture(new TypeError("Cannot read properties of undefined (reading 'name')"));
    await flush(2000);

    expect(stubs.forward).toHaveBeenCalledOnce();
    const envelope = stubs.forward.mock.calls[0]?.[0] ?? "";
    const [header, itemHeader, event] = envelope.split("\n");
    expect(JSON.parse(itemHeader ?? "{}")).toMatchObject({ type: "event" });
    expect(JSON.parse(header ?? "{}")).toHaveProperty("event_id");
    const parsed: unknown = JSON.parse(event ?? "{}");
    expect(parsed).toMatchObject({
      exception: { values: [{ type: "TypeError", value: "Cannot read properties of undefined (reading 'name')" }] },
    });
    expect(JSON.stringify(parsed)).not.toContain("breadcrumbs");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
