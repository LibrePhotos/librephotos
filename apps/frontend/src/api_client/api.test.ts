/**
 * FetchClient turns a failed response into an ApiError. Only `serverMessage`
 * is safe to show a user, so it must stay null whenever the backend did not
 * actually send a readable message. See issue #492.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, fetchClient } from "./api";

vi.mock("../service/notifications", () => ({
  notification: new Proxy({}, { get: () => () => {} }),
}));

function stubResponse(status: number, body: string | null, contentType = "application/json") {
  const response = new Response(body, {
    status,
    statusText: status === 400 ? "Bad Request" : "Error",
    headers: body === null ? {} : { "Content-Type": contentType },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(response))
  );
}

async function expectApiError(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    return error as ApiError;
  }
  throw new Error("expected the request to reject");
}

describe("FetchClient error handling", () => {
  beforeEach(() => {
    // jsdom defaults to about:blank, and handleError reads window.location.pathname
    window.history.pushState({}, "", "/settings");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the first message from a DRF errors body", async () => {
    stubResponse(
      400,
      JSON.stringify({
        errors: [
          { field: "scan_directory", message: "Scan directory does not exist" },
          { field: "auth", message: "a long DEBUG help paragraph that is not for users" },
        ],
      })
    );

    const error = await expectApiError(fetchClient.get("/manage/user/1/"));

    expect(error.status).toBe(400);
    expect(error.serverMessage).toBe("Scan directory does not exist");
    expect(error.message).toBe("Scan directory does not exist");
  });

  it("falls back to the detail field", async () => {
    stubResponse(403, JSON.stringify({ detail: "You do not have permission." }));

    const error = await expectApiError(fetchClient.get("/manage/user/1/"));

    expect(error.status).toBe(403);
    expect(error.serverMessage).toBe("You do not have permission.");
  });

  it("leaves serverMessage null for an empty body", async () => {
    stubResponse(400, null);

    const error = await expectApiError(fetchClient.get("/manage/user/1/"));

    expect(error.status).toBe(400);
    expect(error.serverMessage).toBeNull();
    expect(error.message).toBe("API error: 400 Bad Request");
  });

  it("leaves serverMessage null for a non-JSON body", async () => {
    stubResponse(502, "<html>Bad Gateway</html>", "text/html");

    const error = await expectApiError(fetchClient.get("/manage/user/1/"));

    expect(error.status).toBe(502);
    expect(error.serverMessage).toBeNull();
  });

  it("reports a 500 without a server message, so callers do not show its internal string", async () => {
    stubResponse(500, JSON.stringify({ errors: [{ field: "detail", message: "boom" }] }));

    const error = await expectApiError(fetchClient.get("/manage/user/1/"));

    expect(error.status).toBe(500);
    expect(error.serverMessage).toBeNull();
  });
});
