import { describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { DAY, HOUR, INBOX_RETENTION, type InboxEntry, REPORT_RETENTION, Store } from "../src/store";

function clock(start = Date.UTC(2026, 10, 8, 12)) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("rate limits", () => {
  test("allow up to the limit within an hour", () => {
    const store = new Store(":memory:", clock().now);
    expect([1, 2, 3, 4].map(() => store.take("reports", 3))).toEqual([true, true, true, false]);
  });

  test("count each name on its own", () => {
    const store = new Store(":memory:", clock().now);
    expect(store.take("a", 1)).toBe(true);
    expect(store.take("b", 1)).toBe(true);
    expect(store.take("a", 1)).toBe(false);
  });

  test("start again in the next hour", () => {
    const time = clock();
    const store = new Store(":memory:", time.now);
    store.take("reports", 1);
    expect(store.take("reports", 1)).toBe(false);
    time.advance(HOUR);
    expect(store.take("reports", 1)).toBe(true);
  });

  test("survive a restart", () => {
    const path = `${tmpdir()}/bridge-test-${crypto.randomUUID()}.sqlite`;
    const time = clock();
    const first = new Store(path, time.now);
    first.take("reports", 1);
    first.close();
    const second = new Store(path, time.now);
    expect(second.take("reports", 1)).toBe(false);
    second.close();
    for (const suffix of ["", "-wal", "-shm"]) rmSync(`${path}${suffix}`, { force: true });
  });
});

describe("client keys", () => {
  test("are stable for one address and never contain it", () => {
    const store = new Store(":memory:", clock().now);
    const key = store.clientKey("203.0.113.7");
    expect(store.clientKey("203.0.113.7")).toBe(key);
    expect(store.clientKey("203.0.113.8")).not.toBe(key);
    expect(key).not.toContain("203.0.113.7");
  });
});

describe("seen reports", () => {
  test("are remembered by hash", () => {
    const store = new Store(":memory:", clock().now);
    expect(store.seen("abc")).toBe(false);
    store.remember("abc");
    expect(store.seen("abc")).toBe(true);
  });

  test("hold only a hash and two timestamps", () => {
    const store = new Store(":memory:", clock().now);
    store.remember("abc");
    expect(store.columns("reports")).toEqual(["hash", "first_seen", "last_seen"]);
  });
});

describe("cleanup", () => {
  test("drops counters of past hours and reports past retention", () => {
    const time = clock();
    const store = new Store(":memory:", time.now);
    store.take("reports", 1);
    store.remember("old");
    time.advance(REPORT_RETENTION + HOUR);
    store.remember("new");
    store.cleanup();
    expect(store.seen("old")).toBe(false);
    expect(store.seen("new")).toBe(true);
    expect(store.counterRows()).toBe(0);
  });

  test("keeps a duplicate's hash for the whole retention after it was last seen", () => {
    const time = clock();
    const store = new Store(":memory:", time.now);
    store.remember("abc");
    time.advance(REPORT_RETENTION - HOUR);
    store.remember("abc");
    time.advance(2 * HOUR);
    store.cleanup();
    expect(store.seen("abc")).toBe(true);
  });
});

function entry(overrides: Partial<InboxEntry> = {}): InboxEntry {
  return {
    sender: "jane@example.org",
    from: "Jane <jane@example.org>",
    subject: "Scan stops at 40 %",
    text: "Hello, the scan stops every time.",
    headers: { date: "Sun, 8 Nov 2026 12:00:00 +0000" },
    attachments: [{ name: "screenshot.png", type: "image/png", size: 4 }],
    raw: new TextEncoder().encode("raw message"),
    ...overrides,
  };
}

describe("inbox", () => {
  test("keeps a message and lists it, newest first", () => {
    const time = clock();
    const store = new Store(":memory:", time.now);
    const first = store.keep(entry({ subject: "first" }));
    time.advance(1000);
    const second = store.keep(entry({ subject: "second" }));
    const list = store.inboxList();
    expect(list.map((item) => item.id)).toEqual([second, first]);
    expect(list[0]).toMatchObject({
      from: "Jane <jane@example.org>",
      subject: "second",
      attachments: ["screenshot.png"],
      received: new Date(Date.UTC(2026, 10, 8, 12) + 1000).toISOString(),
    });
  });

  test("lists a short snippet of the text", () => {
    const store = new Store(":memory:", clock().now);
    store.keep(entry({ text: "word ".repeat(200) }));
    expect(store.inboxList()[0]!.snippet.length).toBeLessThanOrEqual(200);
  });

  test("returns one message in full, and its raw bytes", () => {
    const store = new Store(":memory:", clock().now);
    const id = store.keep(entry());
    expect(store.inboxGet(id)).toMatchObject({
      id,
      sender: "jane@example.org",
      text: "Hello, the scan stops every time.",
      headers: { date: "Sun, 8 Nov 2026 12:00:00 +0000" },
      attachments: [{ name: "screenshot.png", type: "image/png", size: 4 }],
    });
    expect(new TextDecoder().decode(store.inboxRaw(id) ?? new Uint8Array())).toBe("raw message");
    expect(store.inboxGet(id + 1)).toBeNull();
    expect(store.inboxRaw(id + 1)).toBeNull();
  });

  test("deletes a message", () => {
    const store = new Store(":memory:", clock().now);
    const id = store.keep(entry());
    expect(store.inboxDelete(id)).toBe(true);
    expect(store.inboxDelete(id)).toBe(false);
    expect(store.inboxList()).toEqual([]);
  });

  test("drops messages past the retention", () => {
    const time = clock();
    const store = new Store(":memory:", time.now);
    store.keep(entry({ subject: "old" }));
    time.advance(INBOX_RETENTION - DAY);
    store.keep(entry({ subject: "new" }));
    time.advance(2 * DAY);
    store.cleanup();
    expect(store.inboxList().map((item) => item.subject)).toEqual(["new"]);
  });

  test("keeps at most the newest messages and bytes", () => {
    const time = clock();
    const store = new Store(":memory:", time.now, { maxMessages: 3, maxBytes: 1000 });
    for (const n of [1, 2, 3, 4]) {
      time.advance(1000);
      store.keep(entry({ subject: `m${n}` }));
    }
    expect(store.inboxList().map((item) => item.subject)).toEqual(["m4", "m3", "m2"]);
    time.advance(1000);
    store.keep(entry({ subject: "big", raw: new Uint8Array(960) }));
    expect(store.inboxList().map((item) => item.subject)).toEqual(["big"]);
  });
});
