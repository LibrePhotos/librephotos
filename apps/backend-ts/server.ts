// Production entry: Bun.serve in front of the built TanStack Start handler
// (bun run build first). Also runs the job worker in-process, like
// `librephotos-rs serve` (LP_WORKER=0 to disable).
import "./src/lib/tz";
import handler from "./dist/server/server.js";
import { startBackground } from "./src/background";

const [host, port] = (process.env.LP_BIND ?? `${process.env.LP_HOST ?? "127.0.0.1"}:${process.env.LP_PORT ?? 8001}`).split(":");
const server = Bun.serve({
  port: Number(port),
  hostname: host,
  idleTimeout: 120,
  maxRequestBodySize: 1024 * 1024 * 1024,
  fetch(req) {
    return handler.fetch(req);
  },
});
console.log(`librephotos-ts listening on ${server.hostname}:${server.port}`);
await startBackground();
