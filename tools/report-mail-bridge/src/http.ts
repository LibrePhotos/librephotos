import { timingSafeEqual } from "node:crypto";
import type { Store } from "./store";

// The HTTP side: /health for everyone, and the inbox API for the maintainers.
// The API exists only when INBOX_API_KEY is set (every /api route is a 404
// otherwise) and wants `Authorization: Bearer <key>`.

// Wrong keys a client may send in an hour before it is locked out for the rest of it.
export const MAX_AUTH_FAILURES = 10;
const FAILURE_DELAY_MS = 1000;

type Options = { store: Store; apiKey: string; failureDelayMs?: number };
export type HttpHandler = (request: Request, client: string) => Promise<Response>;

const notFound = () => new Response("Not found\n", { status: 404 });
const json = (body: unknown) => Response.json(body);

function digest(text: string): Buffer {
  return Buffer.from(new Bun.CryptoHasher("sha256").update(text).digest());
}

/** Constant-time: both sides are hashed to the same length first. */
function sameKey(given: string, expected: string): boolean {
  return timingSafeEqual(digest(given), digest(expected));
}

function bearer(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
}

function route(store: Store, request: Request, path: string): Response {
  const match = /^\/api\/inbox(?:\/(\d+)(\/raw)?)?$/.exec(path);
  if (!match) return notFound();
  const id = match[1] === undefined ? null : Number(match[1]);
  const raw = match[2] !== undefined;
  if (request.method === "GET" && id === null) return json({ messages: store.inboxList() });
  if (id === null) return notFound();
  if (request.method === "DELETE" && !raw) {
    return store.inboxDelete(id) ? new Response(null, { status: 204 }) : notFound();
  }
  if (request.method !== "GET") return notFound();
  if (!raw) {
    const message = store.inboxGet(id);
    return message ? json(message) : notFound();
  }
  const bytes = store.inboxRaw(id);
  if (!bytes) return notFound();
  return new Response(bytes, {
    headers: {
      "Content-Type": "message/rfc822",
      "Content-Disposition": `attachment; filename="inbox-${id}.eml"`,
    },
  });
}

export function createHttpHandler({ store, apiKey, failureDelayMs = FAILURE_DELAY_MS }: Options): HttpHandler {
  const refuse = async (failures: string): Promise<Response> => {
    if (!store.take(failures, MAX_AUTH_FAILURES)) return new Response("Too many attempts\n", { status: 429 });
    await Bun.sleep(failureDelayMs);
    return new Response("Unauthorized\n", { status: 401, headers: { "WWW-Authenticate": "Bearer" } });
  };

  return async (request, client) => {
    const path = new URL(request.url).pathname;
    if (path === "/health") return new Response("ok\n");
    if (!apiKey || !path.startsWith("/api/")) return notFound();
    const failures = `auth-failures:${store.clientKey(client)}`;
    if (store.count(failures) >= MAX_AUTH_FAILURES) return new Response("Too many attempts\n", { status: 429 });
    if (!sameKey(bearer(request), apiKey)) return refuse(failures);
    return route(store, request, path);
  };
}
