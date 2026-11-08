/**
 * #2938: the forwarder posts a browser error to this server only while someone is signed in; a
 * signed-out page (login, a public album) sends nothing, since the server would refuse it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { forwardBrowserError } from "./forwardBrowserError";

const stubs = vi.hoisted(() => ({
  cookies: {} as Partial<Record<"access" | "refresh", string>>,
  post: vi.fn<(endpoint: string, data?: unknown) => Promise<unknown>>(async () => ({ saved: 1 })),
}));

vi.mock("../authCookies", () => ({
  getAuthCookie: (name: "access" | "refresh") => stubs.cookies[name],
}));
vi.mock("../api", () => ({ quietApiClient: { post: stubs.post } }));

beforeEach(() => {
  stubs.cookies = {};
  stubs.post.mockClear();
});

describe("forwardBrowserError", () => {
  it("sends nothing while signed out", async () => {
    await expect(forwardBrowserError("envelope")).resolves.toBe(false);
    expect(stubs.post).not.toHaveBeenCalled();
  });

  it("posts the envelope while signed in", async () => {
    stubs.cookies = { refresh: "r" };
    await expect(forwardBrowserError("envelope")).resolves.toBe(true);
    expect(stubs.post).toHaveBeenCalledWith("/error-reports/browser/", { envelope: "envelope" });
  });
});
