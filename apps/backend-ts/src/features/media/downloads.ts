// GET /api/downloads/{uuid}{userId} (port of lp_media::downloads): a finished
// zip download. Behind nginx this is `try_files /protected_media/zip/$1.zip`,
// unauthenticated; here it is served (or handed to nginx) only to the user
// whose id ends the name, so native dev works without nginx.
import type { User } from "~/lib/users";
import { ZIP_DIR } from "./paths";
import { pjoin } from "./pyfmt";
import { empty, fileRequest, serveFile, xAccel } from "./serve";
import { mediaCtx, zipFileName } from "./view";

export function download(request: Request, user: User, name: string): Response {
  const filename = name.slice(36) === String(user.id) ? zipFileName(name.slice(0, 36), user.id) : undefined;
  if (!filename) return empty(404);
  const ctx = mediaCtx(request);
  const ct = "application/x-zip-compressed";
  if (ctx.proxy) return xAccel(ct, `/protected_media/zip/${filename}`);
  return serveFile(fileRequest(pjoin(ZIP_DIR, filename), ZIP_DIR, ct), ctx.range, ctx.head);
}
