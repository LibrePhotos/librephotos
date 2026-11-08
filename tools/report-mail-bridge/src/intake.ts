import PostalMime from "postal-mime";
import type { Send } from "./glitchtip";
import { type JsonObject, parseReport, reportHash, toEnvelope, toGlitchTipEvent } from "./report";
import type { Store } from "./store";

// What happens to one received message: its JSON attachments are checked,
// and each new, valid report goes to GlitchTip. The body, the sender, the
// subject and every header are read by the MIME parser and then dropped.

export type Reply = { code: number; text: string };
export type Limits = { reportsPerMail: number; reportsPerHour: number };
export type Intake = (message: Uint8Array) => Promise<Reply>;

type Counts = { forwarded: number; duplicates: number; invalid: number; refused: number };

function isReportFile(filename: string | null, mimeType: string): boolean {
  return mimeType === "application/json" || (filename ?? "").toLowerCase().endsWith(".json");
}

function bytesOf(content: ArrayBuffer | Uint8Array | string): Uint8Array {
  if (typeof content === "string") return new TextEncoder().encode(content);
  return content instanceof Uint8Array ? content : new Uint8Array(content);
}

/** The message's JSON attachments, as bytes. */
export async function reportFiles(message: Uint8Array): Promise<Uint8Array[]> {
  const email = await PostalMime.parse(message, { attachmentEncoding: "arraybuffer" });
  return email.attachments
    .filter((attachment) => isReportFile(attachment.filename, attachment.mimeType))
    .map((attachment) => bytesOf(attachment.content));
}

async function filesOf(message: Uint8Array): Promise<Uint8Array[] | null> {
  try {
    return await reportFiles(message);
  } catch {
    return null;
  }
}

function summary(counts: Counts): string {
  return (
    `${counts.forwarded} forwarded, ${counts.duplicates} already received, ` +
    `${counts.invalid} not a report, ${counts.refused} refused`
  );
}

type Options = { store: Store; send: Send; limits: Limits; log: (line: string) => void };

export function createIntake({ store, send, limits, log }: Options): Intake {
  const done = (reply: Reply, counts?: Counts): Reply => {
    const detail = counts
      ? ` forwarded=${counts.forwarded} duplicates=${counts.duplicates} invalid=${counts.invalid} refused=${counts.refused}`
      : "";
    log(`message reply=${reply.code}${detail}`);
    return reply;
  };

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

  return async (message) => {
    const files = await filesOf(message);
    if (!files?.length) return done({ code: 550, text: "5.6.0 No LibrePhotos error report attached" });
    if (files.length > limits.reportsPerMail) {
      return done({ code: 552, text: `5.3.4 At most ${limits.reportsPerMail} reports per email` });
    }
    const counts: Counts = { forwarded: 0, duplicates: 0, invalid: 0, refused: 0 };
    const events: JsonObject[] = [];
    for (const file of files) {
      const parsed = parseReport(file);
      if (parsed.ok) events.push(parsed.event);
      else counts.invalid++;
    }
    if (!events.length) return done({ code: 550, text: "5.6.0 Not a LibrePhotos error report" }, counts);
    for (const event of events) {
      const stop = await forward(event, counts);
      if (stop) return done(stop, counts);
    }
    return done({ code: 250, text: `2.0.0 Thanks: ${summary(counts)}` }, counts);
  };
}
