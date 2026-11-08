import { beforeEach, describe, expect, test } from "bun:test";
import type { SendResult } from "../src/glitchtip";
import { createIntake, reportFiles } from "../src/intake";
import { Store } from "../src/store";

const REPORT = await Bun.file(`${import.meta.dir}/fixtures/librephotos-error-report-7.json`).text();
const BROWSER_REPORT = await Bun.file(`${import.meta.dir}/fixtures/librephotos-error-report-8.json`).text();

type Part = { filename: string; type?: string; content: string };

/** A message as a mail client writes it: a text body and base64 attachments. */
function message(parts: Part[], body = "Hi, see the attached report. Jane <jane@example.org>") {
  const boundary = "----=_Part_42";
  const lines = [
    "From: Jane Doe <jane@example.org>",
    "To: bugs@reports.niaz.omg.lol",
    "Subject: Crash on 192.168.1.20 for jane@example.org",
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    body,
  ];
  for (const part of parts) {
    const base64 = Buffer.from(part.content).toString("base64").replace(/.{76}/g, "$&\r\n");
    lines.push(
      `--${boundary}`,
      `Content-Type: ${part.type ?? "application/json"}; name="${part.filename}"`,
      `Content-Disposition: attachment; filename="${part.filename}"`,
      "Content-Transfer-Encoding: base64",
      "",
      base64,
    );
  }
  lines.push(`--${boundary}--`, "");
  return new TextEncoder().encode(lines.join("\r\n"));
}

const report = (content = REPORT, filename = "librephotos-error-report-7.json") => ({ filename, content });

let sent: string[];
let answer: SendResult;
let logs: string[];
let store: Store;
let intake: ReturnType<typeof createIntake>;

beforeEach(() => {
  sent = [];
  answer = "sent";
  logs = [];
  store = new Store(":memory:");
  intake = createIntake({
    store,
    send: async (envelope) => {
      sent.push(envelope);
      return answer;
    },
    log: (line) => logs.push(line),
    limits: { reportsPerMail: 10, reportsPerHour: 3 },
  });
});

describe("reportFiles", () => {
  test("takes the JSON attachments and nothing else", async () => {
    const files = await reportFiles(
      message([report(), { filename: "photo.jpg", type: "image/jpeg", content: "\xff\xd8" }]),
    );
    expect(files).toHaveLength(1);
    expect(new TextDecoder().decode(files[0])).toBe(REPORT);
  });

  test("finds a .json file sent as application/octet-stream", async () => {
    const files = await reportFiles(
      message([{ filename: "report.JSON", type: "application/octet-stream", content: REPORT }]),
    );
    expect(files).toHaveLength(1);
  });

  test("finds nothing in a plain text mail", async () => {
    const plain = new TextEncoder().encode("Subject: hi\r\n\r\nhello\r\n");
    expect(await reportFiles(plain)).toEqual([]);
  });
});

describe("intake", () => {
  test("forwards a good report", async () => {
    const reply = await intake(message([report()]));
    expect(reply.code).toBe(250);
    expect(sent).toHaveLength(1);
    const event = JSON.parse(sent[0]!.split("\n")[2]!);
    expect(event.tags).toEqual({ source: "server", received_via: "email" });
    expect(event.exception.values[0].type).toBe("DoesNotExist");
  });

  test("forwards nothing of the mail itself", async () => {
    await intake(message([report()]));
    expect(sent[0]).not.toContain("jane");
    expect(sent[0]).not.toContain("192.168.1.20");
    expect(sent[0]).not.toContain("Subject");
    expect(sent[0]).not.toContain("attached report");
  });

  test("forwards each report of a mail", async () => {
    const reply = await intake(message([report(), report(BROWSER_REPORT, "b.json")]));
    expect(reply.code).toBe(250);
    expect(sent).toHaveLength(2);
  });

  test("refuses a mail without a report", async () => {
    const reply = await intake(message([]));
    expect(reply.code).toBe(550);
    expect(sent).toEqual([]);
  });

  test("refuses JSON that is not a report", async () => {
    const reply = await intake(message([report('{"hello": "world"}')]));
    expect(reply.code).toBe(550);
    expect(sent).toEqual([]);
  });

  test("refuses an oversized report", async () => {
    const huge = JSON.stringify({ ...JSON.parse(REPORT), message: "x".repeat(300_000) });
    expect((await intake(message([report(huge)]))).code).toBe(550);
    expect(sent).toEqual([]);
  });

  test("refuses too many reports in one mail", async () => {
    const files = Array.from({ length: 11 }, (_, i) => report(REPORT, `r${i}.json`));
    expect((await intake(message(files))).code).toBe(552);
    expect(sent).toEqual([]);
  });

  test("forwards the good reports of a mail and skips the rest", async () => {
    const reply = await intake(message([report(), report("nope", "x.json")]));
    expect(reply.code).toBe(250);
    expect(reply.text).toContain("1 forwarded");
    expect(reply.text).toContain("1 not a report");
    expect(sent).toHaveLength(1);
  });

  test("skips a report it already forwarded", async () => {
    await intake(message([report()]));
    const reply = await intake(message([report()]));
    expect(reply.code).toBe(250);
    expect(reply.text).toContain("1 already received");
    expect(sent).toHaveLength(1);
  });

  test("gives a report the same event id every time", async () => {
    answer = "unavailable";
    await intake(message([report()]));
    answer = "sent";
    await intake(message([report()]));
    const ids = sent.map((envelope) => JSON.parse(envelope.split("\n")[0]!).event_id);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[0]).toMatch(/^[0-9a-f]{32}$/);
  });

  test("asks the sender to retry while GlitchTip is unavailable", async () => {
    answer = "unavailable";
    expect((await intake(message([report()]))).code).toBe(451);
    answer = "sent";
    expect((await intake(message([report()]))).code).toBe(250);
    expect(sent).toHaveLength(2);
  });

  test("accepts but drops a report GlitchTip refuses", async () => {
    answer = "refused";
    const reply = await intake(message([report()]));
    expect(reply.code).toBe(250);
    expect(reply.text).toContain("1 refused");
  });

  test("stops at the hourly limit", async () => {
    const variants = [1, 2, 3, 4].map((n) =>
      report(JSON.stringify({ ...JSON.parse(REPORT), level: `level${n}` }), `r${n}.json`),
    );
    expect((await intake(message(variants.slice(0, 3)))).code).toBe(250);
    expect((await intake(message(variants.slice(3)))).code).toBe(451);
    expect(sent).toHaveLength(3);
  });

  test("refuses a message that is not MIME at all", async () => {
    expect((await intake(new Uint8Array([0, 1, 2, 3]))).code).toBe(550);
  });

  test("logs counts only", async () => {
    await intake(message([report()]));
    expect(logs.join("\n")).not.toContain("jane");
    expect(logs.join("\n")).not.toContain("DoesNotExist");
    expect(logs.join("\n")).toContain("forwarded=1");
  });
});
