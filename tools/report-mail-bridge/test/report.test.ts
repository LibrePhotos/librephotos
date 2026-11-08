import { describe, expect, test } from "bun:test";
import {
  MAX_REPORT_BYTES,
  type JsonObject,
  parseReport,
  reportHash,
  scrubText,
  toEnvelope,
  toGlitchTipEvent,
} from "../src/report";

async function file(name: string): Promise<Uint8Array> {
  return Bun.file(`${import.meta.dir}/fixtures/${name}`).bytes();
}

function encode(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value, null, 2));
}

async function serverReport(): Promise<JsonObject> {
  return Bun.file(`${import.meta.dir}/fixtures/librephotos-error-report-7.json`).json();
}

describe("parseReport", () => {
  test("accepts a server report as the download endpoint writes it", async () => {
    const result = parseReport(await file("librephotos-error-report-7.json"));
    expect(result.ok).toBe(true);
  });

  test("accepts a browser report", async () => {
    const result = parseReport(await file("librephotos-error-report-8.json"));
    expect(result.ok).toBe(true);
  });

  test("refuses bytes that are not JSON", () => {
    const result = parseReport(new TextEncoder().encode("hello, not json"));
    expect(result).toEqual({ ok: false, reason: "not JSON" });
  });

  test("refuses JSON that is not an object", () => {
    expect(parseReport(encode([1, 2, 3])).ok).toBe(false);
    expect(parseReport(encode("text")).ok).toBe(false);
  });

  test("refuses an unknown top-level field", async () => {
    const event = { ...(await serverReport()), user: { email: "a@b.c" } };
    expect(parseReport(encode(event))).toEqual({ ok: false, reason: "unknown field user" });
  });

  test("refuses an unknown field deep in a frame", async () => {
    const event = await serverReport();
    const values = (event.exception as { values: JsonObject[] }).values;
    const frames = (values[0]!.stacktrace as { frames: JsonObject[] }).frames;
    frames[0]!.vars = { password: "x" };
    expect(parseReport(encode(event))).toEqual({
      ok: false,
      reason: "unknown field exception.values.0.stacktrace.frames.0.vars",
    });
  });

  test("refuses a wrong type", async () => {
    const event = { ...(await serverReport()), level: 3 };
    expect(parseReport(encode(event))).toEqual({ ok: false, reason: "level must be a string" });
  });

  test("refuses a report without the source tag", async () => {
    const event = { ...(await serverReport()), tags: {} };
    expect(parseReport(encode(event))).toEqual({ ok: false, reason: "missing tags.source" });
  });

  test("refuses a source LibrePhotos does not write", async () => {
    const event = { ...(await serverReport()), tags: { source: "phone" } };
    expect(parseReport(encode(event)).ok).toBe(false);
  });

  test("refuses extra tags", async () => {
    const event = { ...(await serverReport()), tags: { source: "server", host: "x" } };
    expect(parseReport(encode(event))).toEqual({ ok: false, reason: "unknown field tags.host" });
  });

  test("refuses a report with no error and no message", async () => {
    const { exception: _, ...event } = await serverReport();
    expect(parseReport(encode(event))).toEqual({ ok: false, reason: "no exception or message" });
  });

  test("accepts a log message report without an exception", async () => {
    const { exception: _, ...event } = await serverReport();
    const result = parseReport(encode({ ...event, logentry: { message: "Scan failed for %s" } }));
    expect(result.ok).toBe(true);
  });

  test("refuses more frames than LibrePhotos keeps", async () => {
    const event = await serverReport();
    const values = (event.exception as { values: JsonObject[] }).values;
    const stack = values[0]!.stacktrace as { frames: JsonObject[] };
    stack.frames = Array.from({ length: 51 }, () => ({ function: "f" }));
    expect(parseReport(encode(event)).ok).toBe(false);
  });

  test("refuses an oversized file", () => {
    const big = new Uint8Array(MAX_REPORT_BYTES + 1).fill(0x20);
    expect(parseReport(big)).toEqual({ ok: false, reason: "too large" });
  });

  test("refuses an overlong string", async () => {
    const event = { ...(await serverReport()), message: "x".repeat(2001) };
    expect(parseReport(encode(event))).toEqual({ ok: false, reason: "message is too long" });
  });
});

describe("reportHash", () => {
  test("is the same for the same report however it is formatted", async () => {
    const event = await serverReport();
    const compact = parseReport(new TextEncoder().encode(JSON.stringify(event)));
    const pretty = parseReport(await file("librephotos-error-report-7.json"));
    if (!compact.ok || !pretty.ok) throw new Error("fixture should parse");
    expect(reportHash(compact.event)).toBe(reportHash(pretty.event));
  });

  test("differs for different reports", async () => {
    const a = await serverReport();
    const b = { ...a, level: "warning" };
    expect(reportHash(a)).not.toBe(reportHash(b));
  });
});

describe("scrubText", () => {
  test("replaces email addresses", () => {
    expect(scrubText("mail jane.doe+x@example.org now")).toBe("mail <email> now");
  });

  test("replaces IPv4 and IPv6 addresses", () => {
    expect(scrubText("from 192.168.1.20 and 2001:db8::1")).toBe("from <ip> and <ip>");
  });

  test("leaves version numbers and times alone", () => {
    expect(scrubText("CPython 3.14.0 at 12:34:56")).toBe("CPython 3.14.0 at 12:34:56");
  });

  test("replaces URLs", () => {
    expect(scrubText("GET https://photos.example.com/api/x?y=1 failed")).toBe("GET <url> failed");
  });

  test("keeps LibrePhotos' own placeholders", () => {
    expect(scrubText("<library> <email> <ip> <url>")).toBe("<library> <email> <ip> <url>");
  });
});

describe("toGlitchTipEvent", () => {
  test("keeps the event, scrubs its strings and tags it as received by email", async () => {
    const event = await serverReport();
    event.message = "user bob@example.com at 10.0.0.1";
    const out = toGlitchTipEvent(event, "a".repeat(32));
    expect(out.event_id).toBe("a".repeat(32));
    expect(out.tags).toEqual({ source: "server", received_via: "email" });
    expect(out.message).toBe("user <email> at <ip>");
    expect(out.transaction).toBe(event.transaction);
    expect(out.exception).toEqual(event.exception);
  });

  test("does not change the input", async () => {
    const event = await serverReport();
    const before = JSON.stringify(event);
    toGlitchTipEvent(event, "b".repeat(32));
    expect(JSON.stringify(event)).toBe(before);
  });
});

describe("toEnvelope", () => {
  test("is a header, an item header and the event, one per line", async () => {
    const event = toGlitchTipEvent(await serverReport(), "c".repeat(32));
    const lines = toEnvelope(event, new Date("2026-11-08T00:00:00Z")).split("\n");
    expect(lines).toHaveLength(4);
    expect(JSON.parse(lines[0]!)).toEqual({
      event_id: "c".repeat(32),
      sent_at: "2026-11-08T00:00:00.000Z",
    });
    const payload = lines[2]!;
    expect(JSON.parse(lines[1]!)).toEqual({
      type: "event",
      content_type: "application/json",
      length: new TextEncoder().encode(payload).length,
    });
    expect(JSON.parse(payload)).toEqual(event);
    expect(lines[3]).toBe("");
  });
});
