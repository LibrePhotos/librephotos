// Mobile delta-sync feeds (/api/sync/*, Django api/views/sync.py): contract
// (the mobile client's own zod schemas in packages/api-client), twin (Django
// on a clone of the same fixture, page by page with the same cursors) and
// the error paths (400 invalid_cursor, 410 cursor_expired, 401, page_size).
import {
  SyncAutoAlbumsResponse,
  SyncCounts,
  SyncPersonsResponse,
  SyncPhotosResponse,
  SyncPlaceAlbumsResponse,
  SyncSharingResponse,
  SyncTagAlbumsResponse,
  SyncThingAlbumsResponse,
  SyncUserAlbumsResponse,
} from "@librephotos/api-client";
import { describe, expect, it } from "vitest";
import type { z } from "zod";

import { call } from "../../src/client";
import { BASE_URL, REF_URL, hasBase } from "../../src/env";
import { manifest, photo, type Role } from "../../src/manifest";
import { expectSchema } from "../../src/schema";
import { expectTwin } from "../../src/twin";

const FEEDS: [string, z.ZodTypeAny][] = [
  ["/api/sync/photos/", SyncPhotosResponse],
  ["/api/sync/persons/", SyncPersonsResponse],
  ["/api/sync/albums/user/", SyncUserAlbumsResponse],
  ["/api/sync/albums/auto/", SyncAutoAlbumsResponse],
  ["/api/sync/albums/thing/", SyncThingAlbumsResponse],
  ["/api/sync/albums/place/", SyncPlaceAlbumsResponse],
  ["/api/sync/albums/tag/", SyncTagAlbumsResponse],
  ["/api/sync/sharing/", SyncSharingResponse],
];
const USERS: Role[] = ["admin", "alice", "bob", "carol", "dave"];
// Everything but server_time (the wall clock of each server).
const ENVELOPE = ["v", "items", "tombstones", "next_cursor", "total"];
// Lists Django builds without an ORDER BY (its order follows the query plan):
// compared as sets. Rust returns them in through-row order.
const UNORDERED = ["items[].cover_hashes", "items[].photo_ids", "tombstones"];

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const cursorFor = (iso: string, pk: string) => Buffer.from(`${iso}|${pk}`, "utf8").toString("base64");

type Envelope = { items: { id: unknown }[]; next_cursor: string | null; server_time: string };

/** Pull `path` to quiescence on both servers with the reference's cursors. */
async function twinPull(role: Role, path: string, schema: z.ZodTypeAny, pageSize: number) {
  let cursor: string | null = null;
  const seen: unknown[] = [];
  for (let page = 0; page < 200; page++) {
    const query: Record<string, string> = { page_size: String(pageSize) };
    if (cursor) query.cursor = cursor;
    const { actual, ref } = await expectTwin(role, { path, query }, { project: ENVELOPE, unordered: UNORDERED });
    const body = expectSchema(schema, actual.body) as Envelope;
    expect(body.server_time).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{6})?\+00:00$/);
    seen.push(...body.items.map(i => i.id));
    cursor = (ref.body as Envelope).next_cursor;
    if (!cursor) return seen;
  }
  throw new Error(`${path} as ${role} did not quiesce`);
}

describe.skipIf(!hasBase)("sync feeds (twin)", () => {
  for (const [path, schema] of FEEDS) {
    it(`${path}: seed + keyset pages match Django for every user`, async () => {
      for (const role of USERS) {
        const seed = await expectTwin(role, { path }, { project: ENVELOPE, unordered: UNORDERED });
        expectSchema(schema, seed.actual.body);
        // Small pages exercise the (last_modified, id) keyset and its tie-break.
        const ids = await twinPull(role, path, schema, 2);
        expect(new Set(ids.map(String)).size).toBe(ids.length);
      }
    });
  }

  it("/api/sync/counts/ matches Django for every user", async () => {
    for (const role of USERS) {
      const { actual } = await expectTwin(role, { path: "/api/sync/counts/" }, {
        project: ["photos", "persons", "user_albums", "auto_albums", "thing_albums", "place_albums", "tags"],
      });
      expectSchema(SyncCounts, actual.body);
    }
  });

  it("scopes: bob sees the photos shared to him, carol the album shared to her", async () => {
    const bob = await call("bob", { path: "/api/sync/photos/", query: { page_size: "1000" } });
    const ids = (bob.body as Envelope).items.map(i => i.id);
    expect(ids).toContain(photo("alice/e2e_06").id);
    expect(ids).toContain(photo("alice/e2e_07").id);
    const carol = await call("carol", { path: "/api/sync/albums/user/" });
    expect((carol.body as Envelope).items.map(i => i.id)).toContain(manifest().albums.user.shared_to_carol!.id);
  });

  it("anonymous is refused on every route", async () => {
    for (const path of [...FEEDS.map(f => f[0]), "/api/sync/counts/"]) {
      const ref = await call("anonymous", { path }, REF_URL);
      const actual = await call("anonymous", { path }, BASE_URL);
      expect([path, actual.status]).toEqual([path, ref.status]);
    }
  });

  it("page_size is parsed like int() and clamped to 1..1000", async () => {
    for (const size of ["0", "-5", "abc", "", "99999", " 3 ", "1_0", "+2", "2.5"]) {
      await expectTwin("alice", { path: "/api/sync/photos/", query: { page_size: size } }, { project: ENVELOPE, unordered: UNORDERED });
    }
  });

  it("cursor errors: 400 invalid_cursor, 410 cursor_expired, 500 like Django", async () => {
    const old = new Date(Date.now() - 91 * 86400_000).toISOString().replace("Z", "+00:00");
    const recent = new Date(Date.now() - 86400_000).toISOString().replace("Z", "+00:00");
    const mangle = (c: string) => `${c.slice(0, 4)}!!${c.slice(4)}`;
    const cases = (pk: string): string[] => [
      "!!!not-base64!!!",
      "",
      b64("no separator"),
      b64(`not a date|${pk}`),
      cursorFor(old, pk),
      cursorFor(recent, pk),
      // Lenient base64: characters outside the alphabet are skipped.
      mangle(cursorFor(recent, pk)),
      cursorFor(recent.replace("+00:00", "+02:00"), pk),
      cursorFor(recent.replace("+00:00", "Z"), pk),
      cursorFor(recent.replace("T", " "), pk),
      Buffer.from([0xff, 0xfe, 0x7c]).toString("base64"),
    ];
    for (const [path, pk] of [
      ["/api/sync/albums/tag/", "5"],
      ["/api/sync/photos/", photo("alice/e2e_01").id],
    ] as const) {
      for (const cursor of cases(pk)) {
        await expectTwin("alice", { path, query: { cursor } }, { project: ["error", ...ENVELOPE] });
      }
    }
    // Server errors on both: a naive datetime, an id of the wrong type.
    for (const [path, cursor] of [
      ["/api/sync/albums/tag/", cursorFor(recent.replace("+00:00", ""), "5")],
      ["/api/sync/photos/", cursorFor(recent, "not-a-uuid")],
      ["/api/sync/albums/user/", cursorFor(recent, "abc")],
    ] as const) {
      const ref = await call("alice", { path, query: { cursor } }, REF_URL);
      const actual = await call("alice", { path, query: { cursor } }, BASE_URL);
      expect([path, cursor, actual.status]).toEqual([path, cursor, ref.status]);
    }
  });
});
