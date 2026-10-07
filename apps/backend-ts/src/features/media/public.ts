// GET /api/public/photo/{slug}/media/{kind} (PublicPhotoMediaBySlug, port of
// lp_media::public): media for a shared photo, addressed by the share's
// slug. Only the big thumbnail, plus the original of a video.
import { photoForShare } from "./queries";
import { empty } from "./serve";
import { generate, generateOriginal, mediaCtx } from "./view";

export async function publicPhotoMedia(request: Request, slug: string, kind: string): Promise<Response> {
  if (kind !== "thumbnail" && kind !== "video") return empty(404);
  const photo = await photoForShare(slug);
  if (!photo) return empty(404);
  const ctx = mediaCtx(request);
  let res: Response;
  if (kind === "thumbnail") res = await generate(ctx, photo, "thumbnails_big", photo.image_hash, false);
  else if (photo.video) res = await generateOriginal(ctx, photo, false, false);
  else return empty(404);
  res.headers.set("Cache-Control", "private, no-cache");
  return res;
}
