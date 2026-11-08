import { beforeEach, describe, expect, test } from "bun:test";
import { createHttpHandler, MAX_AUTH_FAILURES } from "../src/http";
import { type InboxEntry, type InboxSummary, Store } from "../src/store";

const KEY = "k".repeat(64);
const CLIENT = "203.0.113.7";

const entry: InboxEntry = {
  sender: "jane@example.org",
  from: "Jane <jane@example.org>",
  subject: "Scan stops",
  text: "The scan stops at 40 %.",
  headers: { to: "bugs@reports.niaz.omg.lol" },
  attachments: [{ name: "log.txt", type: "text/plain", size: 3 }],
  raw: new TextEncoder().encode("Subject: Scan stops\r\n\r\nThe scan stops at 40 %.\r\n"),
};

let store: Store;
let id: number;

beforeEach(() => {
  store = new Store(":memory:");
  id = store.keep(entry);
});

function call(path: string, options: { key?: string | null; method?: string; client?: string; apiKey?: string } = {}) {
  const handler = createHttpHandler({ store, apiKey: options.apiKey ?? KEY, failureDelayMs: 0 });
  const headers: Record<string, string> = {};
  const key = options.key === undefined ? KEY : options.key;
  if (key !== null) headers.Authorization = `Bearer ${key}`;
  const request = new Request(`http://bridge${path}`, { method: options.method ?? "GET", headers });
  return handler(request, options.client ?? CLIENT);
}

describe("health", () => {
  test("answers without a key", async () => {
    expect((await call("/health", { key: null })).status).toBe(200);
  });

  test("answers even when the inbox API is off", async () => {
    expect((await call("/health", { key: null, apiKey: "" })).status).toBe(200);
  });
});

describe("inbox API", () => {
  test("is not there without INBOX_API_KEY", async () => {
    for (const path of ["/api/inbox", `/api/inbox/${id}`, `/api/inbox/${id}/raw`]) {
      expect((await call(path, { apiKey: "" })).status).toBe(404);
    }
    expect((await call(`/api/inbox/${id}`, { apiKey: "", method: "DELETE" })).status).toBe(404);
  });

  test("wants the key", async () => {
    const missing = await call("/api/inbox", { key: null });
    expect(missing.status).toBe(401);
    expect(missing.headers.get("www-authenticate")).toBe("Bearer");
    expect((await call("/api/inbox", { key: "wrong" })).status).toBe(401);
    expect((await call("/api/inbox", { key: `${KEY}x` })).status).toBe(401);
  });

  test("lists the kept mail", async () => {
    const response = await call("/api/inbox");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { messages: InboxSummary[] };
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]).toMatchObject({
      id,
      from: "Jane <jane@example.org>",
      subject: "Scan stops",
      snippet: "The scan stops at 40 %.",
      attachments: ["log.txt"],
    });
  });

  test("returns one mail in full", async () => {
    const body = await (await call(`/api/inbox/${id}`)).json();
    expect(body).toMatchObject({
      id,
      sender: "jane@example.org",
      text: "The scan stops at 40 %.",
      headers: { to: "bugs@reports.niaz.omg.lol" },
      attachments: [{ name: "log.txt", type: "text/plain", size: 3 }],
    });
  });

  test("returns the raw message as an .eml file", async () => {
    const response = await call(`/api/inbox/${id}/raw`);
    expect(response.headers.get("content-type")).toBe("message/rfc822");
    expect(response.headers.get("content-disposition")).toBe(`attachment; filename="inbox-${id}.eml"`);
    expect(Buffer.from(await response.arrayBuffer()).equals(Buffer.from(entry.raw))).toBe(true);
  });

  test("deletes a mail", async () => {
    expect((await call(`/api/inbox/${id}`, { method: "DELETE" })).status).toBe(204);
    expect((await call(`/api/inbox/${id}`, { method: "DELETE" })).status).toBe(404);
    expect((await call(`/api/inbox/${id}`)).status).toBe(404);
  });

  test("answers 404 for unknown ids and routes", async () => {
    for (const path of [`/api/inbox/${id + 1}`, `/api/inbox/${id + 1}/raw`, "/api/inbox/abc", "/api/other", "/"]) {
      expect((await call(path)).status).toBe(404);
    }
  });

  test("locks out a client after repeated wrong keys, even with the right one", async () => {
    for (let i = 0; i < MAX_AUTH_FAILURES; i++) {
      expect((await call("/api/inbox", { key: "wrong" })).status).toBe(401);
    }
    expect((await call("/api/inbox", { key: "wrong" })).status).toBe(429);
    expect((await call("/api/inbox")).status).toBe(429);
    expect((await call("/api/inbox", { client: "198.51.100.1" })).status).toBe(200);
  });

  test("never echoes the key", async () => {
    const text = await (await call("/api/inbox", { key: "wrong" })).text();
    expect(text).not.toContain("wrong");
    expect(await (await call("/api/inbox")).text()).not.toContain(KEY);
  });
});
