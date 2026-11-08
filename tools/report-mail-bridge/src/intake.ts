import PostalMime, { type Address, type Email } from "postal-mime";
import type { Send } from "./glitchtip";
import { type JsonObject, parseReport, reportHash, toEnvelope, toGlitchTipEvent } from "./report";
import type { InboxEntry, Store } from "./store";

// What happens to one received message.
//
// With at least one valid report attached: each new report goes to GlitchTip,
// and the body, the sender, the subject and every header are dropped.
// Without one: the mail is kept in the inbox (sender, subject, text,
// attachments and the raw message) for the maintainers to read, 30 days at most.

export type Reply = { code: number; text: string };
export type Limits = {
  reportsPerMail: number;
  reportsPerHour: number;
  inboxPerHour: number;
  maxTextChars: number;
};
export type Intake = (message: Uint8Array, sender: string) => Promise<Reply>;

type Counts = { forwarded: number; duplicates: number; invalid: number; refused: number };

function isReportFile(filename: string | null, mimeType: string): boolean {
  return mimeType === "application/json" || (filename ?? "").toLowerCase().endsWith(".json");
}

function bytesOf(content: ArrayBuffer | Uint8Array | string): Uint8Array {
  if (typeof content === "string") return new TextEncoder().encode(content);
  return content instanceof Uint8Array ? content : new Uint8Array(content);
}

function parse(message: Uint8Array): Promise<Email> {
  return PostalMime.parse(message, { attachmentEncoding: "arraybuffer" });
}

function jsonFiles(email: Email): Uint8Array[] {
  return email.attachments
    .filter((attachment) => isReportFile(attachment.filename, attachment.mimeType))
    .map((attachment) => bytesOf(attachment.content));
}

/** The message's JSON attachments, as bytes. */
export async function reportFiles(message: Uint8Array): Promise<Uint8Array[]> {
  return jsonFiles(await parse(message));
}

async function parsed(message: Uint8Array): Promise<Email | null> {
  try {
    return await parse(message);
  } catch {
    return null;
  }
}

const ENTITIES: Record<string, string> = { nbsp: " ", lt: "<", gt: ">", quot: '"', "#39": "'", amp: "&" };

/** Readable text from an HTML body: no scripts, styles or tags. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(nbsp|lt|gt|quot|#39|amp);/g, (_, name: string) => ENTITIES[name] ?? "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function addresses(list: Address[] | Address | undefined): string {
  const all = list === undefined ? [] : Array.isArray(list) ? list : [list];
  return all
    .flatMap((address) => (address.group ? address.group : [address]))
    .map((mailbox) => (mailbox.name ? `${mailbox.name} <${mailbox.address}>` : mailbox.address))
    .join(", ");
}

function headersOf(email: Email): Record<string, string> {
  const headers: Record<string, string> = {
    from: addresses(email.from),
    to: addresses(email.to),
    cc: addresses(email.cc),
    "reply-to": addresses(email.replyTo),
    date: email.date ?? "",
    "message-id": email.messageId ?? "",
  };
  return Object.fromEntries(Object.entries(headers).filter(([, value]) => value));
}

function inboxEntry(email: Email, raw: Uint8Array, sender: string, maxTextChars: number): InboxEntry {
  const text = email.text?.trim() ? email.text : htmlToText(email.html ?? "");
  return {
    sender,
    from: addresses(email.from),
    subject: email.subject ?? "",
    text: text.slice(0, maxTextChars),
    headers: headersOf(email),
    attachments: email.attachments.map((attachment) => ({
      name: attachment.filename ?? "",
      type: attachment.mimeType,
      size: bytesOf(attachment.content).length,
    })),
    raw,
  };
}

function summary(counts: Counts): string {
  return (
    `${counts.forwarded} forwarded, ${counts.duplicates} already received, ` +
    `${counts.invalid} not a report, ${counts.refused} refused`
  );
}

type Options = { store: Store; send: Send; limits: Limits; log: (line: string) => void };

export function createIntake({ store, send, limits, log }: Options): Intake {
  const done = (reply: Reply, detail = ""): Reply => {
    log(`message reply=${reply.code}${detail}`);
    return reply;
  };
  const countsDetail = (counts: Counts) =>
    ` forwarded=${counts.forwarded} duplicates=${counts.duplicates} invalid=${counts.invalid} refused=${counts.refused}`;

  // null: forwarded or skipped, carry on. A reply: stop and answer it.
  const forward = async (event: JsonObject, counts: Counts): Promise<Reply | null> => {
    const hash = reportHash(event);
    if (store.seen(hash)) {
      store.remember(hash);
      counts.duplicates++;
      return null;
    }
    if (!store.take("reports", limits.reportsPerHour)) {
      return { code: 451, text: "4.7.1 Too many reports this hour, try again later" };
    }
    const result = await send(toEnvelope(toGlitchTipEvent(event, hash.slice(0, 32)), new Date()));
    if (result === "unavailable") return { code: 451, text: "4.3.0 GlitchTip is unavailable, try again later" };
    if (result === "refused") counts.refused++;
    else {
      store.remember(hash);
      counts.forwarded++;
    }
    return null;
  };

  const forwardAll = async (events: JsonObject[], counts: Counts): Promise<Reply> => {
    for (const event of events) {
      const stop = await forward(event, counts);
      if (stop) return done(stop, countsDetail(counts));
    }
    return done({ code: 250, text: `2.0.0 Thanks: ${summary(counts)}` }, countsDetail(counts));
  };

  const keep = (email: Email, raw: Uint8Array, sender: string): Reply => {
    const entry = inboxEntry(email, raw, sender, limits.maxTextChars);
    if (!entry.text.trim() && !entry.attachments.length) {
      return done({ code: 550, text: "5.6.0 Empty message" });
    }
    if (!store.take("inbox", limits.inboxPerHour)) {
      return done({ code: 451, text: "4.7.1 Too many messages this hour, try again later" });
    }
    store.keep(entry);
    return done({ code: 250, text: "2.0.0 Thanks, kept for the maintainers to read" }, " kept=inbox");
  };

  return async (message, sender) => {
    const email = await parsed(message);
    if (!email) return done({ code: 550, text: "5.6.0 Cannot read this message" });
    const files = jsonFiles(email);
    if (files.length > limits.reportsPerMail) {
      return done({ code: 552, text: `5.3.4 At most ${limits.reportsPerMail} reports per email` });
    }
    const counts: Counts = { forwarded: 0, duplicates: 0, invalid: 0, refused: 0 };
    const events: JsonObject[] = [];
    for (const file of files) {
      const result = parseReport(file);
      if (result.ok) events.push(result.event);
      else counts.invalid++;
    }
    return events.length ? forwardAll(events, counts) : keep(email, message, sender);
  };
}
