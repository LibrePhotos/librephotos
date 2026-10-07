// Production entry: Bun.serve in front of the built TanStack Start handler
// (bun run build first). Also runs the job worker in-process, like
// `librephotos-rs serve` (LP_WORKER=0 to disable).
import "./src/lib/tz";
import handler from "./dist/server/server.js";
import { startBackground } from "./src/background";
import { ApiError } from "./src/lib/errors";

const FILE_BODY = Symbol.for("librephotos.fileBody");

const [host, port] = (process.env.LP_BIND ?? `${process.env.LP_HOST ?? "127.0.0.1"}:${process.env.LP_PORT ?? 8001}`).split(":");
const server = Bun.serve({
  port: Number(port),
  hostname: host,
  idleTimeout: 120,
  maxRequestBodySize: 1024 * 1024 * 1024,
  async fetch(req) {
    const res = await handler.fetch(req);
    // A large media file: Start's handler reads Response.body, which turns a
    // Bun.file body into a plain stream without Content-Length, so the
    // media code hands the file slice over here (src/features/media/serve.ts).
    const file = (res as unknown as Record<symbol, Blob | undefined>)[FILE_BODY];
    if (file) {
      void res.body?.cancel();
      return new Response(file, { status: res.status, headers: res.headers });
    }
    // A route without a handler for this method falls through to Start's
    // SSR renderer (an HTML 200). The API has no pages: answer like DRF.
    // Media refusals are empty text/html responses too (Django's default
    // content type, Content-Length: 0); those are real answers.
    if (res.headers.get("content-type")?.startsWith("text/html") && res.headers.get("content-length") !== "0") {
      const path = new URL(req.url).pathname;
      if (path.startsWith("/api/") || path.startsWith("/media/")) return ApiError.methodNotAllowed(req.method).toResponse();
    }
    return res;
  },
});
console.log(`librephotos-ts listening on ${server.hostname}:${server.port}`);
await startBackground();
