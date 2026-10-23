import { User } from "@librephotos/api-client";
import type { WhatsNewHighlight, WhatsNewRelease } from "./whatsNewReleases";

/** A user who joined long before the test releases and last saw 1.3.0's card. */
export function testUser(overrides: Record<string, unknown> = {}): User {
  return User.parse({
    id: 7,
    username: "ada",
    email: "",
    confidence: 0.5,
    transcode_videos: false,
    semantic_search_topk: 0,
    first_name: "Ada",
    public_photo_samples: [],
    last_name: "Lovelace",
    public_photo_count: 0,
    date_joined: "2025-01-01T00:00:00Z",
    photo_count: 0,
    favorite_min_rating: 4,
    image_scale: 1,
    save_metadata_to_disk: "OFF",
    datetime_rules: "[]",
    default_timezone: "UTC",
    public_sharing: false,
    min_cluster_size: 2,
    min_samples: 1,
    cluster_selection_epsilon: 0.05,
    llm_settings: null,
    is_superuser: false,
    last_seen_release: "1.3.0",
    show_whats_new: true,
    ...overrides,
  });
}

/** A highlight for the tests; `admin` makes it one only admins see. */
export function highlight(id: string, audience: WhatsNewHighlight["audience"] = "all"): WhatsNewHighlight {
  return {
    id,
    audience,
    title: `Title of ${id}`,
    body: `Body of ${id}.`,
    learn_more: `https://docs.librephotos.com/docs/${id}`,
  };
}

/** A release for the tests, published on `date`, covering `versions` (itself by default). */
export function release(
  tag: string,
  date: string,
  highlights: WhatsNewHighlight[] = [highlight(`${tag}-a`)],
  versions: string[] = [tag]
): WhatsNewRelease {
  return {
    release: tag,
    versions,
    date,
    title: `${tag}: Something new`,
    summary: `What ${tag} brings.`,
    url: `https://docs.librephotos.com/blog/${tag.replaceAll(".", "-")}`,
    highlights,
  };
}

/** Newest first, like releases.json: 1.0.0 covers its patch releases, 1.2.1 has no highlights. */
export const RELEASES: readonly WhatsNewRelease[] = [
  release("1.4.0", "2026-10-17T12:00:00.000Z", [
    highlight("edits"),
    highlight("many"),
    highlight("filters"),
    highlight("collections"),
    highlight("finish-upgrade", "admin"),
  ]),
  release("1.3.0", "2026-10-11T11:36:15.000Z", [highlight("timeline"), highlight("thumbnails", "admin")]),
  release("1.2.1", "2026-09-29T13:11:11.000Z", []),
  release("1.2.0", "2026-09-29T08:09:51.000Z", [highlight("windows")]),
  release("1.1.0", "2026-08-28T08:25:11.000Z", [highlight("sso")]),
  release("1.0.0", "2026-06-26T10:53:57.000Z", [highlight("versions")], ["1.0.0", "1.0.1", "1.0.2"]),
];
