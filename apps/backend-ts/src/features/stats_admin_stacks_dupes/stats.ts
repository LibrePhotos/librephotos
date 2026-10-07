// Dashboards (api/views/dataviz.py over api/stats.py): /api/stats/,
// /api/photomonthcounts/, /api/wordcloud/, /api/socialgraph/,
// /api/locationsunburst/, /api/locationtimeline/. Port of
// lp_api::stats_admin_stacks_dupes::stats and lp_db's stats reads.
import { sql, type SQL } from "drizzle-orm";
import { row, rows } from "~/lib/db";
import { pyTruthy } from "~/lib/query";
import { ownedBy, visibleManager } from "~/lib/scope";
import { siteSettings } from "~/lib/settings";
import { UNKNOWN_PERSON_NAME, pyStr } from "./common";
import { hlsPalette, pairedPalette, springLayout } from "./layout";

const visibleOwned = (userId: number, extra: SQL = sql``) =>
  sql`(SELECT count(*)::int FROM api_photo p WHERE ${ownedBy("p", userId)} AND ${visibleManager("p")}${extra})`;

const nonEmptyAlbums = (kind: "auto" | "date" | "user", userId: number) => {
  const t = sql.raw(`api_album${kind}`);
  return sql`(SELECT count(*)::int FROM ${t} a WHERE EXISTS (SELECT 1 FROM ${sql.raw(`api_album${kind}_photos`)} ap
    WHERE ap.${sql.raw(`album${kind}_id`)} = a.id AND ap.photo_id IS NOT NULL) AND a.owner_id = ${userId})`;
};

const faces = (userId: number, cond: SQL) =>
  sql`(SELECT count(*)::int FROM api_face f JOIN api_photo p ON p.id = f.photo_id WHERE ${cond}${ownedBy("p", userId)})`;

/** get_count_stats: one round trip, every counter a scalar subquery. */
export async function countStats(userId: number) {
  // Q(files=None) | Q(main_file=None) is a LEFT JOIN on the link table, so a
  // photo without a main file counts once per linked file, like Django.
  return row(sql`SELECT
    ${visibleOwned(userId)} AS num_photos,
    ${visibleOwned(userId, sql` AND p.is_screenshot`)} AS num_screenshots,
    ${visibleOwned(userId, sql` AND p.is_document`)} AS num_documents,
    (SELECT count(*)::int FROM api_photo p LEFT JOIN api_photo_files pf ON pf.photo_id = p.id
      WHERE (pf.file_id IS NULL OR p.main_file_id IS NULL) AND ${ownedBy("p", userId)}) AS num_missing_photos,
    ${faces(userId, sql``)} AS num_faces,
    (SELECT count(DISTINCT f.person_id)::int FROM api_face f JOIN api_photo p ON p.id = f.photo_id
      WHERE f.person_id IS NOT NULL AND NOT p.hidden AND ${ownedBy("p", userId)}) AS num_people,
    (SELECT count(*)::int FROM api_face f JOIN api_photo p ON p.id = f.photo_id JOIN api_person pe ON pe.id = f.person_id
      WHERE pe.name IN ('unknown', ${UNKNOWN_PERSON_NAME}) AND ${ownedBy("p", userId)}) AS num_unknown_faces,
    ${faces(userId, sql`f.person_id IS NOT NULL AND NOT p.hidden AND `)} AS num_labeled_faces,
    ${faces(userId, sql`f.person_id IS NULL AND NOT p.hidden AND `)} AS num_inferred_faces,
    ${nonEmptyAlbums("auto", userId)} AS num_albumauto,
    ${nonEmptyAlbums("date", userId)} AS num_albumdate,
    ${nonEmptyAlbums("user", userId)} AS num_albumuser`);
}

/**
 * get_photo_month_counts: every month from the first to the last one in
 * 2000..=this year, zero-filled, keyed "YYYY-M".
 */
export async function photoMonthCounts(userId: number) {
  const rs = await rows<{ y: number; m: number; c: number }>(sql`SELECT extract(year FROM t.month)::int AS y,
      extract(month FROM t.month)::int AS m, t.c
    FROM (SELECT date_trunc('month', p.exif_timestamp AT TIME ZONE 'UTC') AS month, count(p.image_hash)::int AS c
          FROM api_photo p WHERE p.exif_timestamp IS NOT NULL AND ${ownedBy("p", userId)} GROUP BY 1) t`);
  const thisYear = new Date().getUTCFullYear();
  const keys = rs.filter((r) => r.y >= 2000 && r.y <= thisYear).map((r) => r.y * 12 + (r.m - 1));
  if (!keys.length) return [];
  const counts = new Map(rs.map((r) => [r.y * 12 + (r.m - 1), r.c]));
  const out: { month: string; count: number }[] = [];
  const last = Math.max(...keys);
  for (let k = Math.min(...keys); k <= last; k++) {
    out.push({ month: `${Math.floor(k / 12)}-${(k % 12) + 1}`, count: counts.get(k) ?? 0 });
  }
  return out;
}

/** _LabelTally: counts plus the order labels were first seen in. */
class LabelTally {
  counts = new Map<string, number>();
  firstSeen = new Map<string, number>();
  add(label: string, order: { n: number }, firstSeen?: number) {
    this.counts.set(label, (this.counts.get(label) ?? 0) + 1);
    if (!this.firstSeen.has(label)) {
      this.firstSeen.set(label, firstSeen ?? order.n);
      order.n++;
    }
  }
  top(limit: number) {
    return [...this.counts.entries()]
      .sort((a, b) => b[1] - a[1] || (this.firstSeen.get(a[0]) ?? 1e6) - (this.firstSeen.get(b[0]) ?? 1e6))
      .slice(0, limit)
      .map(([label, c]) => ({ label, y: Math.log(c) }));
  }
}

/** _tag_labels: the tagging model's `tags` list of one photo. */
function tagLabels(entry: unknown): string[] {
  const tags = entry && typeof entry === "object" ? (entry as Record<string, unknown>).tags : undefined;
  return Array.isArray(tags) ? tags.filter(pyTruthy).map(pyStr) : [];
}

const isPostcodeOrPoi = (t: unknown) => t === "postcode" || t === "poi";

/** _location_texts: feature texts except postcodes and POIs, deduplicated. */
function locationTexts(features: unknown): string[] {
  const out: string[] = [];
  if (!Array.isArray(features)) return out;
  for (const f of features) {
    if (!f || typeof f !== "object" || Array.isArray(f)) continue;
    const o = f as Record<string, unknown>;
    if (!pyTruthy(o.text)) continue;
    const pt = o.place_type;
    const skip = Array.isArray(pt) ? pt.some((t) => pyTruthy(t) && isPostcodeOrPoi(t)) : pt !== undefined && isPostcodeOrPoi(pt);
    const text = pyStr(o.text);
    if (!skip && !out.includes(text)) out.push(text);
  }
  return out;
}

const geoFeatures = (userId: number) =>
  rows<{ f: unknown }>(sql`SELECT p.geolocation_json -> 'features' AS f FROM api_photo p
    WHERE jsonb_typeof(p.geolocation_json -> 'features') = 'array' AND ${ownedBy("p", userId)}`);

export async function wordCloud(userId: number) {
  const model = (await siteSettings()).TAGGING_MODEL;
  const [captions, geo, people] = await Promise.all([
    rows<{ e: unknown }>(sql`SELECT pc.captions_json -> ${model}::text AS e FROM api_photo p
      JOIN api_photo_caption pc ON pc.photo_id = p.id WHERE pc.captions_json IS NOT NULL AND ${ownedBy("p", userId)}`),
    geoFeatures(userId),
    rows<{ name: string; c: number }>(sql`SELECT pe.name, count(f.id)::int AS c FROM api_face f
      JOIN api_photo p ON p.id = f.photo_id JOIN api_person pe ON pe.id = f.person_id
      WHERE ${ownedBy("p", userId)} GROUP BY pe.name ORDER BY c DESC LIMIT 100`),
  ]);
  const order = { n: 0 };
  const captionTally = new LabelTally();
  for (const { e } of captions) for (const label of tagLabels(e)) captionTally.add(label, order);
  const locationTally = new LabelTally();
  for (const { f } of geo) for (const text of locationTexts(f)) locationTally.add(text, order, captionTally.firstSeen.get(text));
  return {
    captions: captionTally.top(100),
    people: people.map((p) => ({ label: p.name, y: Math.log(p.c) })),
    locations: locationTally.top(100),
  };
}

/** build_social_graph: nodes in first-seen order, one link per unordered pair. */
export function socialGraph(links: [string, string][]) {
  const index = new Map<string, number>();
  const names: string[] = [];
  const adj: number[][] = [];
  const slot = (name: string) => {
    let i = index.get(name);
    if (i === undefined) {
      i = names.length;
      index.set(name, i);
      names.push(name);
      adj.push([]);
    }
    return i;
  };
  const linked = new Set<number>();
  for (const [a, b] of links) {
    for (const [u, v] of [
      [a, b],
      [b, a],
    ]) {
      const ui = slot(u);
      const vi = slot(v);
      const key = ui * 0x100000 + vi;
      if (!linked.has(key)) {
        linked.add(key);
        adj[ui].push(vi);
      }
    }
  }
  const edges: [number, number][] = [];
  const seen = new Set<number>();
  adj.forEach((list, u) => {
    for (const v of list) {
      const key = Math.min(u, v) * 0x100000 + Math.max(u, v);
      if (!seen.has(key)) {
        seen.add(key);
        edges.push([u, v]);
      }
    }
  });
  const pos = springLayout(names.length, edges, 0.5, 1000, 20);
  return {
    nodes: names.map((id, i) => ({ id, x: pos[i][0], y: pos[i][1] })),
    links: edges.map(([u, v]) => ({ source: names[u], target: names[v] })),
  };
}

/** Person-name pairs that share a photo, in the order Postgres returns Django's statement. */
export async function socialGraphView(userId: number) {
  const rs = await rows<{ a: string; b: string }>(sql`WITH face AS (
        SELECT photo_id, person_id, name, owner_id
        FROM api_face
        JOIN api_person ON api_person.id = person_id
        JOIN api_photo ON api_photo.id = photo_id
        WHERE person_id IS NOT NULL
            AND owner_id = ${userId}
    )
    SELECT f1.name AS a, f2.name AS b
    FROM face f1
    JOIN face f2 USING (photo_id)
    WHERE f1.person_id != f2.person_id
    GROUP BY f1.name, f2.name`);
  return socialGraph(rs.map((r) => [r.a, r.b]));
}

const jsonEq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** get_location_sunburst: country > region > place, counted, sorted. */
export function locationSunburst(features: unknown[], palette: string[]) {
  const counter = new Map<string, { key: [string, string, string]; texts: [unknown, unknown, unknown]; count: number }>();
  for (const f of features) {
    if (!Array.isArray(f) || f.length < 3) continue;
    const text = (i: number) => {
      const o = f[f.length - i];
      const t = o && typeof o === "object" && !Array.isArray(o) ? (o as Record<string, unknown>).text : undefined;
      return t === null ? undefined : t;
    };
    const l1 = text(1), l2 = text(2), l3 = text(3);
    if (l1 === undefined || l2 === undefined || l3 === undefined) continue;
    const key: [string, string, string] = [pyStr(l1), pyStr(l2), pyStr(l3)];
    const k = JSON.stringify(key);
    const e = counter.get(k);
    if (e) e.count++;
    else counter.set(k, { key, texts: [l1, l2, l3], count: 1 });
  }
  const sorted = [...counter.values()].sort((a, b) => cmpStr(a.key[0], b.key[0]) || cmpStr(a.key[1], b.key[1]) || cmpStr(a.key[2], b.key[2]));
  const pick = () => palette[Math.floor(Math.random() * palette.length)] ?? "";
  type Node = Record<string, unknown>;
  const root: Node[] = [];
  for (const { texts, count } of sorted) {
    const [l1, l2, l3] = texts;
    let cursor = root;
    for (const [depth, item] of [l1, l2].entries()) {
      // `item in c.values()`: the last child with any equal value.
      let idx = -1;
      for (let i = cursor.length - 1; i >= 0; i--) {
        if (Object.values(cursor[i]).some((v) => jsonEq(v, item))) {
          idx = i;
          break;
        }
      }
      if (idx < 0) {
        cursor.push({ name: item, children: [], hex: pick() });
        idx = cursor.length - 1;
      }
      const children = cursor[idx].children;
      if (!Array.isArray(children)) break;
      cursor = children as Node[];
      if (depth === 1) cursor.push({ name: l3, value: count, hex: pick() });
    }
  }
  return { name: "Places I've visited", children: root };
}

export async function locationSunburstView(userId: number) {
  const rs = await geoFeatures(userId);
  return locationSunburst(
    rs.map((r) => r.f),
    hlsPalette(10),
  );
}

/** get_location_timeline: runs of the same last-feature text, each ending where the next begins. */
export async function locationTimeline(userId: number) {
  const rs = await rows<{ loc: unknown; us: number }>(sql`SELECT p.geolocation_json -> 'features' -> -1 -> 'text' AS loc,
      (extract(epoch FROM p.exif_timestamp) * 1000000)::float8 AS us
    FROM api_photo p WHERE p.exif_timestamp IS NOT NULL AND ${ownedBy("p", userId)} ORDER BY p.exif_timestamp`);
  const spans: { loc: unknown; begin: number; end: number }[] = [];
  for (const { loc, us } of rs) {
    if (loc === null || loc === undefined) continue;
    const last = spans[spans.length - 1];
    if (last && jsonEq(last.loc, loc)) last.end = us;
    else spans.push({ loc, begin: us, end: us });
  }
  const colors = pairedPalette(spans.length);
  return spans.map((s, i) => {
    const end = i + 1 < spans.length ? spans[i + 1].begin : s.end;
    return { data: [(end - s.begin) / 1e6], color: colors[i], loc: s.loc, start: s.begin / 1e6, end: end / 1e6 };
  });
}
