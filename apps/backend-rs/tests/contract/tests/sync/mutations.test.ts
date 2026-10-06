// Delete-then-sync on both servers (each on its own clone): seed every feed
// for alice, bob and carol, run deletes / un-shares / re-shares / link
// changes through the API, then pull the deltas from the seed cursors and
// compare what each client would apply: items (minus the servers' own
// timestamps) and tombstones. run_suite.sh then diffs the databases,
// api_deletionlog included (mut:sync).
//
// Only runs with LP_MUTATION=1: it changes both databases.
import { describe, expect, it } from "vitest";

import { call, type Request } from "../../src/client";
import { BASE_URL, REF_URL, hasBase } from "../../src/env";
import { manifest, photo, type Role } from "../../src/manifest";
import { formatDifferences } from "../../src/project";
import { twin } from "../../src/twin";

const enabled = hasBase && process.env.LP_MUTATION === "1";

const FEEDS = [
  "/api/sync/photos/",
  "/api/sync/persons/",
  "/api/sync/albums/user/",
  "/api/sync/albums/auto/",
  "/api/sync/albums/thing/",
  "/api/sync/albums/place/",
  "/api/sync/albums/tag/",
  "/api/sync/sharing/",
];
const VIEWERS: Role[] = ["alice", "bob", "carol"];
// Set from each server's own clock: never equal across the twins.
const CLOCK_FIELDS = new Set(["last_modified", "created_on"]);

type Item = Record<string, unknown> & { id: unknown };
type Envelope = { items: Item[]; tombstones: string[]; next_cursor: string | null };

async function pull(role: Role, path: string, base: string, cursor: string | null) {
  const items = new Map<string, Item>();
  const tombstones: string[] = [];
  let durable = cursor;
  for (let page = 0; page < 500; page++) {
    const query: Record<string, string> = { page_size: "7" };
    if (durable) query.cursor = durable;
    const res = await call(role, { path, query }, base);
    if (res.status !== 200) throw new Error(`${path} as ${role} on ${base}: ${res.status} ${res.text}`);
    const body = res.body as Envelope;
    for (const item of body.items) {
      const clean = Object.fromEntries(Object.entries(item).filter(([k]) => !CLOCK_FIELDS.has(k)));
      items.set(String(item.id), clean as Item);
    }
    tombstones.push(...body.tombstones);
    if (!body.next_cursor) return { items, tombstones, cursor: durable };
    durable = body.next_cursor;
  }
  throw new Error(`${path} as ${role} did not quiesce`);
}

type Cursors = Map<string, { ref: string | null; rs: string | null }>;

async function seed(): Promise<Cursors> {
  const cursors: Cursors = new Map();
  for (const role of VIEWERS) {
    for (const path of FEEDS) {
      const ref = await pull(role, path, REF_URL, null);
      const rs = await pull(role, path, BASE_URL, null);
      expect([role, path, [...rs.items.keys()].sort()]).toEqual([role, path, [...ref.items.keys()].sort()]);
      cursors.set(`${role} ${path}`, { ref: ref.cursor, rs: rs.cursor });
    }
  }
  return cursors;
}

/** The deltas since `cursors`: every client must apply the same change. */
async function deltas(cursors: Cursors) {
  const problems: string[] = [];
  const seen: Record<string, { items: string[]; tombstones: string[] }> = {};
  for (const role of VIEWERS) {
    for (const path of FEEDS) {
      const c = cursors.get(`${role} ${path}`)!;
      const ref = await pull(role, path, REF_URL, c.ref);
      const rs = await pull(role, path, BASE_URL, c.rs);
      const key = `${role} ${path}`;
      const sortedItems = (m: Map<string, Item>) =>
        [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => JSON.stringify(v));
      if (JSON.stringify(sortedItems(ref.items)) !== JSON.stringify(sortedItems(rs.items))) {
        problems.push(`${key} items:\n  ref ${sortedItems(ref.items).join("\n      ")}\n  rs  ${sortedItems(rs.items).join("\n      ")}`);
      }
      const t = (x: string[]) => [...x].sort();
      if (JSON.stringify(t(ref.tombstones)) !== JSON.stringify(t(rs.tombstones))) {
        problems.push(`${key} tombstones: ref ${JSON.stringify(t(ref.tombstones))} rs ${JSON.stringify(t(rs.tombstones))}`);
      }
      seen[key] = { items: [...rs.items.keys()].sort(), tombstones: t(rs.tombstones) };
    }
  }
  expect(problems).toEqual([]);
  return seen;
}

type Step = { role: Role; req: Request; project?: string[] };

async function run(steps: Step[]) {
  const problems: string[] = [];
  for (const step of steps) {
    const { differences, actual } = await twin(step.role, step.req, {
      project: step.project ?? [],
      refStable: false,
    });
    const statusOnly = differences.filter(d => d.path === "<status>");
    const shown = step.project ? differences : statusOnly;
    if (shown.length > 0) {
      problems.push(`${step.req.method ?? "GET"} ${step.req.path} as ${step.role} (${actual.status}):\n${formatDifferences(shown)}`);
    }
  }
  expect(problems).toEqual([]);
}

const hash = (key: string) => photo(key).image_hash;

describe.skipIf(!enabled)("sync tombstones after deletes and un-shares (twin)", () => {
  it("every client converges to the same mirror on both servers", async () => {
    const m = manifest();
    const bob = m.users.bob.id;
    const carol = m.users.carol.id;
    const nextPerson = Math.max(...Object.values(m.persons).map(p => p.id)) + 1;
    const cursors = await seed();

    const share = (keys: string[], shared: boolean, target: number): Step => ({
      role: "alice",
      req: { method: "POST", path: "/api/photosedit/share/", body: { image_hashes: keys.map(hash), val_shared: shared, target_user_id: target } },
      project: ["status", "count"],
    });
    const albumShare = (album: number, target: number, shared: boolean): Step => ({
      role: "alice",
      req: { method: "POST", path: "/api/useralbum/share/", body: { album_id: album, target_user_id: target, shared } },
    });

    await run([
      // Photo un-share: bob loses e2e_06 (tombstone); e2e_07 is un-shared and
      // re-shared (its tombstone is cancelled); e2e_03 is newly shared.
      share(["alice/e2e_06", "alice/e2e_07"], false, bob),
      share(["alice/e2e_07", "alice/e2e_03"], true, bob),
      // Un-sharing a photo that was never shared still tombstones it.
      share(["alice/e2e_08"], false, carol),
      // Album un-share: carol loses "Shared with Carol".
      albumShare(m.albums.user.shared_to_carol!.id, carol, false),
      // Album delete: the owner and the recipient each get a tombstone.
      albumShare(m.albums.user.vacation!.id, bob, true),
      { role: "alice", req: { method: "DELETE", path: `/api/albums/user/${m.albums.user.vacation!.id}/` } },
      { role: "bob", req: { method: "DELETE", path: `/api/albums/user/${m.albums.user.public_trip!.id}/` } },
      // Auto album delete.
      { role: "alice", req: { method: "DELETE", path: `/api/albums/auto/${m.albums.auto.find(a => a.owner === "alice")!.id}/` } },
      // Tags: delete, link change (bump), merge (bump + tombstone of the source).
      { role: "alice", req: { method: "DELETE", path: `/api/tags/${m.tags[0]!.id}/` } },
      { role: "alice", req: { method: "POST", path: `/api/tags/${m.tags[2]!.id}/add/`, body: { photos: [photo("alice/e2e_01").id] } } },
      { role: "alice", req: { method: "POST", path: `/api/tags/${m.tags[2]!.id}/remove/`, body: { photos: [photo("alice/e2e_01").id] } } },
      { role: "alice", req: { method: "POST", path: `/api/tags/${m.tags[4]!.id}/merge/`, body: { tag: m.tags[1]!.id } } },
      { role: "bob", req: { method: "DELETE", path: `/api/tags/${m.tags[3]!.id}/` } },
      // Persons: a USER person created and deleted (tombstone).
      { role: "alice", req: { method: "POST", path: "/api/persons/", body: { name: "Sync Zed" } } },
      { role: "alice", req: { method: "DELETE", path: `/api/persons/${nextPerson}/` } },
    ]);

    const seen = await deltas(cursors);
    // The tombstones the mobile client depends on are there at all.
    expect(seen["bob /api/sync/photos/"]!.tombstones).toContain(photo("alice/e2e_06").id);
    expect(seen["bob /api/sync/photos/"]!.tombstones).not.toContain(photo("alice/e2e_07").id);
    expect(seen["bob /api/sync/photos/"]!.items).toContain(photo("alice/e2e_03").id);
    expect(seen["carol /api/sync/photos/"]!.tombstones).toContain(photo("alice/e2e_08").id);
    expect(seen["carol /api/sync/albums/user/"]!.tombstones).toContain(String(m.albums.user.shared_to_carol!.id));
    expect(seen["alice /api/sync/albums/user/"]!.tombstones).toContain(String(m.albums.user.vacation!.id));
    expect(seen["bob /api/sync/albums/user/"]!.tombstones).toContain(String(m.albums.user.vacation!.id));
    expect(seen["alice /api/sync/albums/tag/"]!.tombstones).toEqual(
      [String(m.tags[0]!.id), String(m.tags[1]!.id)].sort(),
    );
    expect(seen["alice /api/sync/albums/tag/"]!.items).toContain(String(m.tags[2]!.id));
    expect(seen["alice /api/sync/persons/"]!.tombstones).toEqual([String(nextPerson)]);
  });
});
