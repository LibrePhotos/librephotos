import { isIP } from "node:net";

// A LibrePhotos error report file: checking it, scrubbing it again, and
// turning it into the event GlitchTip receives.
//
// The file is what the Error reports page's Download button writes
// (apps/backend/api/views/error_reports.py, ErrorReportDownloadView): the
// saved event, already scrubbed by apps/backend/api/error_reports/scrub.py.
// That scrubber rebuilds every event from an allowlist, so the shape below is
// exactly what it can produce. Anything else is refused.

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

// A saved event is at most 64 KiB as compact JSON (store.py, MAX_EVENT_BYTES);
// the download is indented, which roughly doubles it.
export const MAX_REPORT_BYTES = 256 * 1024;

// The scrubber's own limits (scrub.py): MAX_TEXT, MAX_FRAMES, MAX_EXCEPTIONS,
// MAX_CONTEXT_LINES.
const MAX_TEXT = 2000;
const MAX_FRAMES = 50;
const MAX_EXCEPTIONS = 5;
const MAX_CONTEXT_LINES = 5;

type Shape =
  | "string"
  | "number"
  | "boolean"
  | "string or number"
  | { list: Shape; max: number }
  | { fields: Record<string, Shape> }
  | { oneOf: readonly string[] };

const text: Shape = "string";
const nameAndVersion: Shape = { fields: { name: text, version: text } };
const frame: Shape = {
  fields: {
    filename: text,
    abs_path: text,
    module: text,
    function: text,
    lineno: "number",
    colno: "number",
    in_app: "boolean",
    context_line: text,
    pre_context: { list: text, max: MAX_CONTEXT_LINES },
    post_context: { list: text, max: MAX_CONTEXT_LINES },
  },
};
const exception: Shape = {
  fields: {
    type: text,
    value: text,
    module: text,
    mechanism: { fields: { type: text, handled: "boolean" } },
    stacktrace: { fields: { frames: { list: frame, max: MAX_FRAMES } } },
  },
};
const report: Shape = {
  fields: {
    event_id: text,
    platform: text,
    level: text,
    logger: text,
    environment: text,
    timestamp: "string or number",
    release: text,
    transaction: text,
    message: text,
    logentry: { fields: { message: text, formatted: text } },
    exception: { fields: { values: { list: exception, max: MAX_EXCEPTIONS } } },
    sdk: nameAndVersion,
    contexts: {
      fields: { runtime: nameAndVersion, os: nameAndVersion, browser: nameAndVersion },
    },
    request: { fields: { method: text, headers: { fields: { "User-Agent": text } } } },
    tags: { fields: { source: { oneOf: ["server", "browser"] } } },
  },
};

function isObject(value: Json): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function checkScalar(value: Json, shape: string, path: string): string | null {
  const ok =
    shape === "string or number"
      ? typeof value === "string" || typeof value === "number"
      : typeof value === shape;
  if (!ok) return `${path} must be a ${shape}`;
  if (typeof value === "string" && value.length > MAX_TEXT) return `${path} is too long`;
  return null;
}

function checkList(value: Json, shape: { list: Shape; max: number }, path: string): string | null {
  if (!Array.isArray(value)) return `${path} must be a list`;
  if (value.length > shape.max) return `${path} has too many items`;
  for (const [index, item] of value.entries()) {
    const problem = check(item, shape.list, `${path}.${index}`);
    if (problem) return problem;
  }
  return null;
}

function checkFields(value: Json, fields: Record<string, Shape>, path: string): string | null {
  if (!isObject(value)) return `${path} must be an object`;
  for (const [key, item] of Object.entries(value)) {
    const shape = fields[key];
    const at = path ? `${path}.${key}` : key;
    if (shape === undefined) return `unknown field ${at}`;
    const problem = check(item, shape, at);
    if (problem) return problem;
  }
  return null;
}

function check(value: Json, shape: Shape, path: string): string | null {
  if (typeof shape === "string") return checkScalar(value, shape, path);
  if ("list" in shape) return checkList(value, shape, path);
  if ("fields" in shape) return checkFields(value, shape.fields, path);
  return typeof value === "string" && shape.oneOf.includes(value)
    ? null
    : `${path} must be one of ${shape.oneOf.join(", ")}`;
}

function child(event: JsonObject, key: string): JsonObject | null {
  const value = event[key];
  return value !== undefined && isObject(value) ? value : null;
}

function hasError(event: JsonObject): boolean {
  const values = child(event, "exception")?.values;
  return (Array.isArray(values) && values.length > 0) || "logentry" in event || "message" in event;
}

function parseJson(bytes: Uint8Array): Json | undefined {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return undefined;
  }
}

export type ParseResult = { ok: true; event: JsonObject } | { ok: false; reason: string };

/** The report in `bytes`, or why it is not one. */
export function parseReport(bytes: Uint8Array): ParseResult {
  if (bytes.length > MAX_REPORT_BYTES) return { ok: false, reason: "too large" };
  const event = parseJson(bytes);
  if (event === undefined) return { ok: false, reason: "not JSON" };
  if (!isObject(event)) return { ok: false, reason: "not an object" };
  const problem = check(event, report, "");
  if (problem) return { ok: false, reason: problem };
  if (child(event, "tags")?.source === undefined) return { ok: false, reason: "missing tags.source" };
  if (!hasError(event)) return { ok: false, reason: "no exception or message" };
  return { ok: true, event };
}

function canonical(value: Json): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (!isObject(value)) return JSON.stringify(value);
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key] ?? null)}`).join(",")}}`;
}

/** SHA-256 of the report's content, the same however the file is formatted. */
export function reportHash(event: JsonObject): string {
  return new Bun.CryptoHasher("sha256").update(canonical(event)).digest("hex");
}

// The same patterns as scrub.py. LibrePhotos' placeholders (<email>, <ip>,
// <url>, <path>, ...) contain none of these, so a second pass keeps them.
const URL_PATTERN = /\b[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s'"<>]+/g;
const EMAIL_PATTERN = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const IPV4_PATTERN = /\b\d{1,3}(?:\.\d{1,3}){3}\b/g;
const IPV6_PATTERN = /(?<![\w:])[0-9a-fA-F]{0,4}(?::[0-9a-fA-F]{0,4}){2,7}(?![\w:])/g;


/** `text` with email and IP addresses and URLs replaced, as scrub.py does. */
export function scrubText(text: string): string {
  const ip = (match: string) => (isIP(match) ? "<ip>" : match);
  return text
    .replace(URL_PATTERN, "<url>")
    .replace(EMAIL_PATTERN, "<email>")
    .replace(IPV4_PATTERN, ip)
    .replace(IPV6_PATTERN, ip);
}

function scrubObject(value: JsonObject): JsonObject {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scrubJson(item)]));
}

function scrubJson(value: Json): Json {
  if (typeof value === "string") return scrubText(value);
  if (Array.isArray(value)) return value.map(scrubJson);
  return isObject(value) ? scrubObject(value) : value;
}

/** The event GlitchTip receives: the report, scrubbed again, tagged as received by email. */
export function toGlitchTipEvent(event: JsonObject, eventId: string): JsonObject {
  const scrubbed = scrubObject(event);
  const tags = child(scrubbed, "tags") ?? {};
  return { ...scrubbed, event_id: eventId, tags: { ...tags, received_via: "email" } };
}

/** `event` as a Sentry envelope: the envelope header, the item header, the event. */
export function toEnvelope(event: JsonObject, sentAt: Date): string {
  const payload = JSON.stringify(event);
  const header = { event_id: event.event_id ?? null, sent_at: sentAt.toISOString() };
  const item = {
    type: "event",
    content_type: "application/json",
    length: new TextEncoder().encode(payload).length,
  };
  return `${JSON.stringify(header)}\n${JSON.stringify(item)}\n${payload}\n`;
}
