import { describe, expect, test } from "bun:test";
import { glitchTipSender, parseDsn } from "../src/glitchtip";

const DSN = "https://publickey@errors.example.org/7";

describe("parseDsn", () => {
  test("finds the envelope URL and the auth header", () => {
    const dsn = parseDsn(DSN);
    expect(dsn.url).toBe("https://errors.example.org/api/7/envelope/");
    expect(dsn.auth).toBe(
      "Sentry sentry_version=7, sentry_client=librephotos-report-mail-bridge/1, sentry_key=publickey",
    );
  });

  test("keeps a path prefix and a port", () => {
    expect(parseDsn("http://k@host:8000/glitchtip/12").url).toBe(
      "http://host:8000/glitchtip/api/12/envelope/",
    );
  });

  test("refuses a DSN without a key or a project", () => {
    expect(() => parseDsn("https://errors.example.org/7")).toThrow();
    expect(() => parseDsn("https://k@errors.example.org/")).toThrow();
    expect(() => parseDsn("not a url")).toThrow();
  });
});

function fakeFetch(answer: () => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return answer();
  };
  return { calls, fetcher };
}

describe("glitchTipSender", () => {
  test("posts the envelope with the auth header", async () => {
    const { calls, fetcher } = fakeFetch(() => new Response("{}", { status: 200 }));
    const result = await glitchTipSender(DSN, fetcher)("envelope-bytes");
    expect(result).toBe("sent");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://errors.example.org/api/7/envelope/");
    expect(calls[0]!.init.method).toBe("POST");
    expect(calls[0]!.init.body).toBe("envelope-bytes");
    const headers = new Headers(calls[0]!.init.headers);
    expect(headers.get("content-type")).toBe("application/x-sentry-envelope");
    expect(headers.get("x-sentry-auth")).toContain("sentry_key=publickey");
  });

  test("a bad-event answer means the event was refused for good", async () => {
    for (const status of [400, 413, 422]) {
      const { fetcher } = fakeFetch(() => new Response("bad", { status }));
      expect(await glitchTipSender(DSN, fetcher)("x")).toBe("refused");
    }
  });

  test("a 5xx, 429 or auth answer means try again later", async () => {
    for (const status of [401, 403, 404, 429, 500, 503]) {
      const { fetcher } = fakeFetch(() => new Response("", { status }));
      expect(await glitchTipSender(DSN, fetcher)("x")).toBe("unavailable");
    }
  });

  test("a network error means try again later", async () => {
    const { fetcher } = fakeFetch(() => {
      throw new TypeError("connection refused");
    });
    expect(await glitchTipSender(DSN, fetcher)("x")).toBe("unavailable");
  });
});
