// TanStack Start's server entry, customized: everything the process needs
// lives in this one Vite bundle, so lib/db (the connection pool), the job
// worker and the routes share one module instance. (Importing src/ from the
// root server.ts next to dist/server/server.js gave a second copy of every
// module: two pools, two Drizzle schemas.)
//
// lpFetch wraps Start's handler:
// - /media/* GET|HEAD go straight to the media view (no router), and file
//   bodies are handed to Bun.serve as Bun.file slices (sendfile, Content-Length)
// - a request for a method a route has no handler for falls through to
//   Start's SSR page (an HTML 200); the API answers DRF's 405 instead
import "./lib/tz";
import handler, { createServerEntry } from "@tanstack/react-start/server-entry";
import { startBackground } from "./background";
import { media } from "./features/media/view";
import { FILE_BODY, useDirectFileBodies } from "./features/media/serve";
import { ApiError, errorResponse } from "./lib/errors";
import { PEER_HEADER } from "./lib/http";
import { installLogFile } from "./lib/logfile";

export { startBackground, installLogFile };

/** Called by the root server.ts (Bun.serve) once, before serving. */
export function prepareServer() {
  installLogFile();
  useDirectFileBodies();
}

function withFileBody(res: Response): Response {
  // A file answer: Start (or the media view) attached the file slice; give
  // Bun the Blob so it sends the file itself with a Content-Length.
  const file = (res as unknown as Record<symbol, Blob | undefined>)[FILE_BODY];
  if (!file) return res;
  void res.body?.cancel();
  return new Response(file, { status: res.status, headers: res.headers });
}

export async function lpFetch(req: Request, peer?: string): Promise<Response> {
  // REMOTE_ADDR for routes (DRF get_ident's last resort); a client-sent copy is dropped.
  req.headers.delete(PEER_HEADER);
  if (peer) req.headers.set(PEER_HEADER, peer);
  const url = new URL(req.url);
  if ((req.method === "GET" || req.method === "HEAD") && url.pathname.startsWith("/media/")) {
    try {
      return withFileBody(await media(req, url));
    } catch (e) {
      return errorResponse(e);
    }
  }
  const res = withFileBody(await handler.fetch(req));
  // Real HTML answers are left alone: the upload views' Django 404/400
  // pages (not 200) and empty media responses (Content-Length: 0).
  if (
    res.status === 200 &&
    res.headers.get("content-type")?.startsWith("text/html") &&
    res.headers.get("content-length") !== "0" &&
    (url.pathname.startsWith("/api/") || url.pathname.startsWith("/media/"))
  ) {
    return ApiError.methodNotAllowed(req.method).toResponse();
  }
  return res;
}

export default createServerEntry({ fetch: (req: Request) => lpFetch(req) });
