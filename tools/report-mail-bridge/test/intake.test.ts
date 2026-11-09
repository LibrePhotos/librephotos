import { beforeEach, describe, expect, test } from "bun:test";
import type { SendResult } from "../src/glitchtip";
import { createIntake, reportFiles } from "../src/intake";
import { Store } from "../src/store";

const REPORT = await Bun.file(`${import.meta.dir}/fixtures/librephotos-error-report-7.json`).text();
const BROWSER_REPORT = await Bun.file(`${import.meta.dir}/fixtures/librephotos-error-report-8.json`).text();

type Part = { filename: string; type?: string; content: string };

/** A message as a mail client writes it: a text body and base64 attachments. */
function message(
  parts: Part[],
  body = "Hi, see the attached report. Jane <jane@example.org>",
  bodyType = "text/plain",
) {
  const boundary = "----=_Part_42";
  const lines = [
    "From: Jane Doe <jane@example.org>",
    "To: bugs@reports.niaz.omg.lol",
    "Subject: Crash on 192.168.1.20 for jane@example.org",
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    `Content-Type: ${bodyType}; charset=utf-8`,
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
const receive = (raw: Uint8Array) => intake(raw, "jane@example.org");

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
    limits: { reportsPerMail: 10, reportsPerHour: 3, inboxPerHour: 3, maxTextChars: 1000 },
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
    const reply = await receive(message([report()]));
    expect(reply.code).toBe(250);
    expect(sent).toHaveLength(1);
    const event = JSON.parse(sent[0]!.split("\n")[2]!);
    expect(event.tags).toEqual({ source: "server", received_via: "email" });
    expect(event.exception.values[0].type).toBe("DoesNotExist");
  });

  test("forwards nothing of the mail itself", async () => {
    await receive(message([report()]));
    expect(sent[0]).not.toContain("jane");
    expect(sent[0]).not.toContain("192.168.1.20");
    expect(sent[0]).not.toContain("Subject");
    expect(sent[0]).not.toContain("attached report");
  });

  test("forwards each report of a mail", async () => {
    const reply = await receive(message([report(), report(BROWSER_REPORT, "b.json")]));
    expect(reply.code).toBe(250);
    expect(sent).toHaveLength(2);
  });

  test("keeps a mail without a report in the inbox", async () => {
    const raw = message([], "The scan stops at 40 %.");
    const reply = await receive(raw);
    expect(reply.code).toBe(250);
    expect(sent).toEqual([]);
    const [kept] = store.inboxList();
    expect(kept).toMatchObject({
      from: "Jane Doe <jane@example.org>",
      subject: "Crash on 192.168.1.20 for jane@example.org",
      attachments: [],
    });
    const full = store.inboxGet(kept!.id);
    expect(full).toMatchObject({ sender: "jane@example.org", text: "The scan stops at 40 %." });
    expect(full?.headers.to).toBe("bugs@reports.niaz.omg.lol");
    expect(store.inboxRaw(kept!.id)).toEqual(raw);
  });

  test("keeps the names, types and sizes of its attachments", async () => {
    await receive(message([{ filename: "screen.png", type: "image/png", content: "PNG!" }]));
    expect(store.inboxGet(store.inboxList()[0]!.id)?.attachments).toEqual([
      { name: "screen.png", type: "image/png", size: 4 },
    ]);
  });

  test("keeps a mail whose JSON is not a report", async () => {
    const reply = await receive(message([report('{"hello": "world"}', "settings.json")]));
    expect(reply.code).toBe(250);
    expect(sent).toEqual([]);
    expect(store.inboxList()[0]?.attachments).toEqual(["settings.json"]);
  });

  test("keeps a mail with an oversized report instead of forwarding it", async () => {
    const huge = JSON.stringify({ ...JSON.parse(REPORT), message: "x".repeat(300_000) });
    expect((await receive(message([report(huge)]))).code).toBe(250);
    expect(sent).toEqual([]);
    expect(store.inboxList()).toHaveLength(1);
  });

  test("keeps the text of an HTML-only mail", async () => {
    await receive(message([], "<p>Scan <b>stops</b></p><script>x()</script><p>at 40&nbsp;%</p>", "text/html"));
    const text = store.inboxGet(store.inboxList()[0]!.id)?.text ?? "";
    expect(text).toContain("Scan stops");
    expect(text).toContain("at 40");
    expect(text).not.toContain("<");
    expect(text).not.toContain("x()");
  });

  test("cuts a very long text", async () => {
    await receive(message([], "y".repeat(5000)));
    expect(store.inboxGet(store.inboxList()[0]!.id)?.text.length).toBe(1000);
  });

  test("refuses an empty mail", async () => {
    const empty = new TextEncoder().encode("From: a@b.c\r\nSubject: \r\n\r\n \r\n");
    expect((await receive(empty)).code).toBe(550);
    expect(store.inboxList()).toEqual([]);
  });

  test("stops keeping mail at the hourly inbox limit", async () => {
    for (const n of [1, 2, 3]) expect((await receive(message([], `note ${n}`))).code).toBe(250);
    expect((await receive(message([], "note 4"))).code).toBe(451);
    expect(store.inboxList()).toHaveLength(3);
  });

  test("does not keep a mail that holds a report", async () => {
    await receive(message([report(), report("nope", "x.json")]));
    expect(store.inboxList()).toEqual([]);
  });

  test("refuses too many reports in one mail", async () => {
    const files = Array.from({ length: 11 }, (_, i) => report(REPORT, `r${i}.json`));
    expect((await receive(message(files))).code).toBe(552);
    expect(sent).toEqual([]);
  });

  test("forwards the good reports of a mail and skips the rest", async () => {
    const reply = await receive(message([report(), report("nope", "x.json")]));
    expect(reply.code).toBe(250);
    expect(reply.text).toContain("1 forwarded");
    expect(reply.text).toContain("1 not a report");
    expect(sent).toHaveLength(1);
  });

  test("skips a report it already forwarded", async () => {
    await receive(message([report()]));
    const reply = await receive(message([report()]));
    expect(reply.code).toBe(250);
    expect(reply.text).toContain("1 already received");
    expect(sent).toHaveLength(1);
  });

  test("gives a report the same event id every time", async () => {
    answer = "unavailable";
    await receive(message([report()]));
    answer = "sent";
    await receive(message([report()]));
    const ids = sent.map((envelope) => JSON.parse(envelope.split("\n")[0]!).event_id);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[0]).toMatch(/^[0-9a-f]{32}$/);
  });

  test("asks the sender to retry while GlitchTip is unavailable", async () => {
    answer = "unavailable";
    expect((await receive(message([report()]))).code).toBe(451);
    answer = "sent";
    expect((await receive(message([report()]))).code).toBe(250);
    expect(sent).toHaveLength(2);
  });

  test("accepts but drops a report GlitchTip refuses", async () => {
    answer = "refused";
    const reply = await receive(message([report()]));
    expect(reply.code).toBe(250);
    expect(reply.text).toContain("1 refused");
  });

  test("stops at the hourly limit", async () => {
    const variants = [1, 2, 3, 4].map((n) =>
      report(JSON.stringify({ ...JSON.parse(REPORT), level: `level${n}` }), `r${n}.json`),
    );
    expect((await receive(message(variants.slice(0, 3)))).code).toBe(250);
    expect((await receive(message(variants.slice(3)))).code).toBe(451);
    expect(sent).toHaveLength(3);
  });

  test("logs counts only", async () => {
    await receive(message([report()]));
    expect(logs.join("\n")).not.toContain("jane");
    expect(logs.join("\n")).not.toContain("DoesNotExist");
    expect(logs.join("\n")).toContain("forwarded=1");
  });
});
