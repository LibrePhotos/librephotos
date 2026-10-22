import { z } from "zod";
import data from "./releases.json";

/**
 * One highlight of a release: the "What's new for you" bullet from its release post, with the
 * docs section that explains it and, optionally, where to try it in the app.
 */
const WhatsNewHighlight = z.object({
  id: z.string(),
  /** `admin`: something only an admin can see or do. */
  audience: z.enum(["all", "admin"]),
  title: z.string(),
  body: z.string(),
  /** An absolute docs.librephotos.com link. */
  learn_more: z.string(),
  /** A path in this app, e.g. `/` for the timeline. */
  open_in_app: z.string().optional(),
});
export type WhatsNewHighlight = z.infer<typeof WhatsNewHighlight>;

const WhatsNewRelease = z.object({
  release: z.string(),
  /** Every tag the post covers (a release and its patch releases). */
  versions: z.string().array(),
  /** When it was published, an ISO instant. */
  date: z.string(),
  title: z.string(),
  summary: z.string(),
  /** Its release post on docs.librephotos.com. */
  url: z.string(),
  highlights: WhatsNewHighlight.array(),
});
export type WhatsNewRelease = z.infer<typeof WhatsNewRelease>;

/**
 * `releases.json` is generated from the release posts by `apps/docs/scripts/build-releases.mjs`
 * (#2305), newest release first; `whatsNewReleases.test.ts` checks it against this schema.
 */
export const WhatsNewData = z.object({ releases: WhatsNewRelease.array() });

/** The bundled releases, newest first. Nothing is fetched: many servers have no internet access. */
export const WHATS_NEW_RELEASES: readonly WhatsNewRelease[] = WhatsNewData.parse(data).releases;
