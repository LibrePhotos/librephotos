// Production entry: Bun.serve in front of the built TanStack Start handler
// (bun run build first). Also runs the job worker in-process, like
// `librephotos-rs serve` (LP_WORKER=0 to disable).
import "./src/lib/tz";
import handler from "./dist/server/server.js";
import { startBackground } from "./src/background";
import { ApiError } from "./src/lib/errors";
import { PEER_HEADER } from "./src/lib/http";

const [host, port] = (process.env.LP_BIND ?? `${process.env.LP_HOST ?? "127.0.0.1"}:${process.env.LP_PORT ?? 8001}`).split(":");
const server = Bun.serve({
  port: Number(port),
  hostname: host,
  idleTimeout: 120,
  maxRequestBodySize: 1024 * 1024 * 1024,
  async fetch(req, srv) {
    // REMOTE_ADDR for routes (DRF get_ident's last resort); a client-sent copy is dropped.
    req.headers.delete(PEER_HEADER);
    const peer = srv.requestIP(req)?.address;
    if (peer) req.headers.set(PEER_HEADER, peer);
    const res = await handler.fetch(req);
    // A route without a handler for this method falls through to Start's
    // SSR renderer (an HTML 200). The API has no pages: answer like DRF.
    if (res.headers.get("content-type")?.startsWith("text/html")) {
      const path = new URL(req.url).pathname;
      if (path.startsWith("/api/") || path.startsWith("/media/")) return ApiError.methodNotAllowed(req.method).toResponse();
    }
    return res;
  },
});
console.log(`librephotos-ts listening on ${server.hostname}:${server.port}`);
await startBackground();
