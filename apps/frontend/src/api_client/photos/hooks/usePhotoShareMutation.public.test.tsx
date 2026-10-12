/**
 * The public photo page loads its photo through the API client, like the
 * public album page: a 404 (unknown or revoked link) is an answer, `null`,
 * and any other failure is the client's ApiError with its status.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { settledQuery } from "../../../util/hookHarness.test-utils";
import { ApiError } from "../../api";
import { useFetchSharedPhotoQuery } from "./usePhotoShareMutation";

const notifications = vi.hoisted(() => ({ serverError: vi.fn<(endpoint: string) => void>() }));
vi.mock("../../../service/notifications", () => ({
  notification: new Proxy(notifications, {
    get: (target, name) => (name === "serverError" ? target.serverError : () => {}),
  }),
}));

function respond(status: number, body: unknown = null) {
  const fetchMock = vi.fn<typeof fetch>(
    async () =>
      new Response(body === null ? null : JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      })
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("useFetchSharedPhotoQuery", () => {
  beforeEach(() => {
    // A visitor on the public page: a 401 there logs nobody out.
    window.history.pushState({}, "", "/public/p/a%20b");
  });

  it("returns the shared photo, requested through the client", async () => {
    const fetchMock = respond(200, { results: { video: false, thumbnail_url: "/t", video_url: null } });

    const result = await settledQuery(() => useFetchSharedPhotoQuery("a b"));

    expect(result.data).toMatchObject({ video: false, thumbnail_url: "/t" });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/public/photo/a%20b/");
  });

  it("returns null for an unknown or revoked link (404)", async () => {
    respond(404, { errors: [{ field: "detail", message: "Not found." }] });

    const result = await settledQuery(() => useFetchSharedPhotoQuery("gone"));

    expect(result.isError).toBe(false);
    expect(result.data).toBeNull();
  });

  it("fails with the client's ApiError, and its server-error toast, on a 500", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    respond(500);

    const result = await settledQuery(() => useFetchSharedPhotoQuery("broken"));

    expect(result.error).toBeInstanceOf(ApiError);
    expect(result.error).toMatchObject({ status: 500 });
    expect(notifications.serverError).toHaveBeenCalled();
  });
});
