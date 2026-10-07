// Production entry: Bun.serve in front of the built server bundle
// (bun run build first; src/server.ts is its entry). Also runs the job worker
// in-process, like `librephotos-rs serve` (LP_WORKER=0 to disable).
// Import nothing from src/ here: the bundle has its own copy of every module.
import { lpFetch, prepareServer, startBackground } from "./dist/server/server.js";

prepareServer();

const [host, port] = (process.env.LP_BIND ?? `${process.env.LP_HOST ?? "127.0.0.1"}:${process.env.LP_PORT ?? 8001}`).split(":");
const server = Bun.serve({
  port: Number(port),
  hostname: host,
  idleTimeout: 120,
  maxRequestBodySize: 1024 * 1024 * 1024,
  fetch(req, srv) {
    return lpFetch(req, srv.requestIP(req)?.address);
  },
});
console.log(`librephotos-ts listening on ${server.hostname}:${server.port}`);
startBackground().catch((e: unknown) => {
  console.error("background start failed", e);
  process.exit(1);
});
