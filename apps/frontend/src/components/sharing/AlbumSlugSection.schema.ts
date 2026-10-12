import type { TFunction } from "i18next";
import { z } from "zod";

const sharingOption = z.boolean().nullable().optional();

/**
 * The public link settings of an album. Whether another album holds the slug is asked of the
 * server and reported through `form.setFieldError`. The expiry is "" (never) or the instant the
 * picker produced; the server takes any instant, so there is no rule for it here.
 */
export function makeAlbumLinkSchema(t: TFunction) {
  return z.object({
    slug: z
      .string()
      .trim()
      .regex(/^[a-z0-9-]{3,64}$/i, { error: t("sharing.customUrlError") }),
    expires_at: z.string(),
    sharing_options: z.object({
      share_location: sharingOption,
      share_camera_info: sharingOption,
      share_timestamps: sharingOption,
      share_captions: sharingOption,
      share_faces: sharingOption,
    }),
  });
}
