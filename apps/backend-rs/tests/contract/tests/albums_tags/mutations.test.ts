// Mutations of the albums_tags area, sent in the same order to Django
// (LP_REF_URL) and the server under test (LP_BASE_URL), each running on its
// own clone of the fixture with its own media copy. Responses are compared
// here; the resulting database states are diffed afterwards with
// dump_state.py (see ../../../fixture/albums_tags_mutations.sh).
//
// Only runs with LP_MUTATION=1: it changes both databases.
import { UserAlbum } from "@librephotos/api-client";
import { Tag } from "@fe/tags/types";
import { describe, expect, it } from "vitest";

import { call, type Request } from "../../src/client";
import { hasBase } from "../../src/env";
import { manifest, photo, type Role } from "../../src/manifest";
import { expectSchema } from "../../src/schema";
import { twin, type TwinSpec } from "../../src/twin";
import { formatDifferences } from "../../src/project";

const enabled = hasBase && process.env.LP_MUTATION === "1";

type Step = { role: Role; req: Request; spec?: Partial<TwinSpec> };

async function run(steps: Step[]) {
  const problems: string[] = [];
  for (const step of steps) {
    const { differences, actual } = await twin(step.role, step.req, {
      project: ["*"],
      refStable: false,
      ...step.spec,
    });
    if (differences.length > 0) {
      problems.push(
        `${step.req.method ?? "GET"} ${step.req.path} as ${step.role} (${actual.status}):\n${formatDifferences(differences)}`,
      );
    }
  }
  expect(problems).toEqual([]);
}

const id = (key: string) => photo(key).id;
const hash = (key: string) => photo(key).image_hash;

// created_on is auto_now: both servers set it to their own "now".
const EDIT = { project: ["id", "title", "photos", "favorited", "cover_photo"], unordered: ["photos"] };
const LIST_ITEM = {
  project: [
    "id",
    "cover_photo",
    "favorited",
    "title",
    "shared_to",
    "owner",
    "photo_count",
    "public",
    "public_slug",
    "public_expires_at",
    "public_sharing_options",
  ],
  unordered: ["shared_to"],
};
const PAGE_OF_ITEMS = {
  project: ["count", ...LIST_ITEM.project.map(p => `results[].${p}`)],
  unordered: ["results[].shared_to"],
};
const DETAIL = {
  project: ["id", "title", "owner", "shared_to", "grouped_photos", "public", "public_slug", "public_sharing_options"],
  unordered: ["shared_to", "grouped_photos[].items"],
};

describe.skipIf(!enabled)("albums_tags mutations (twin)", () => {
  it("user album edits", async () => {
    const m = manifest();
    const vacation = m.albums.user.vacation!;
    // The next AlbumUser id on both clones.
    const next = Math.max(...Object.values(m.albums.user).map(a => a.id)) + 1;
    await run([
      // Validation failures write nothing.
      { role: "alice", req: { method: "POST", path: "/api/albums/user/edit/", body: { title: "X", photos: [id("bob/own_01")] } } },
      { role: "alice", req: { method: "POST", path: "/api/albums/user/edit/", body: { title: "X", photos: ["abc", true] } } },
      { role: "alice", req: { method: "POST", path: "/api/albums/user/edit/", body: { photos: "x", select_all: "maybe" } } },
      { role: "alice", req: { method: "POST", path: "/api/albums/user/edit/", body: { title: " ", photos: [] } } },
      // Create.
      {
        role: "alice",
        req: { method: "POST", path: "/api/albums/user/edit/", body: { title: "Mutation Album", photos: [id("alice/e2e_03"), id("alice/e2e_04")] } },
        spec: EDIT,
      },
      // An existing title goes through update(): add, remove, cover.
      {
        role: "alice",
        req: {
          method: "POST",
          path: "/api/albums/user/edit/",
          body: {
            title: vacation.title,
            photos: [id("alice/e2e_05")],
            removedPhotos: [hash("alice/e2e_01")],
            cover_photo: id("alice/e2e_05"),
          },
        },
        spec: EDIT,
      },
      // Select-all add with exclusions.
      {
        role: "alice",
        req: {
          method: "PATCH",
          path: `/api/albums/user/edit/${next}/`,
          body: { title: "Mutation Album", photos: [], select_all: true, query: { favorite: true }, excluded_hashes: [hash("alice/e2e_02")] },
        },
        spec: EDIT,
      },
      {
        role: "alice",
        req: { method: "PATCH", path: `/api/albums/user/edit/${next}/`, body: { title: "Mutation Album", photos: [id("alice/video")] } },
        spec: EDIT,
      },
      { role: "alice", req: { method: "PATCH", path: `/api/albums/user/edit/${next}/`, body: { removedPhotos: [hash("alice/e2e_03")] } }, spec: EDIT },
      { role: "alice", req: { method: "PATCH", path: `/api/albums/user/edit/${next}/`, body: { cover_photo: id("alice/e2e_04") } }, spec: EDIT },
      { role: "alice", req: { method: "PATCH", path: `/api/albums/user/edit/${next}/`, body: { cover_photo: id("bob/own_01") } } },
      // Someone else's album.
      { role: "bob", req: { method: "PATCH", path: `/api/albums/user/edit/${next}/`, body: { title: "stolen" } } },
      // Rename through the album viewset.
      { role: "alice", req: { method: "PATCH", path: `/api/albums/user/${next}/`, body: { title: "Renamed Album" } }, spec: DETAIL },
      { role: "alice", req: { method: "PATCH", path: `/api/albums/user/${next}/`, body: { title: "" } } },
      { role: "carol", req: { method: "PATCH", path: `/api/albums/user/${m.albums.user.shared_to_carol!.id}/`, body: { title: "mine" } } },
      // An empty album (for the empty-cover shape below).
      { role: "alice", req: { method: "POST", path: "/api/albums/user/edit/", body: { title: "Empty Album", photos: [] } }, spec: EDIT },
    ]);
    const res = await call("alice", { path: `/api/albums/user/${next}/` });
    expectSchema(UserAlbum, res.body);
  });

  it("sharing and public links", async () => {
    const m = manifest();
    const next = Math.max(...Object.values(m.albums.user).map(a => a.id)) + 1;
    const bob = m.users.bob.id;
    const carol = m.users.carol.id;
    await run([
      { role: "alice", req: { method: "POST", path: "/api/useralbum/share/", body: { album_id: next, target_user_id: bob, shared: true } }, spec: LIST_ITEM },
      { role: "alice", req: { method: "POST", path: "/api/useralbum/share/", body: { album_id: String(next + 1), target_user_id: String(carol), shared: true } }, spec: LIST_ITEM },
      {
        role: "alice",
        req: { method: "POST", path: "/api/useralbum/share/", body: { album_id: m.albums.user.shared_to_carol!.id, target_user_id: carol, shared: false } },
        spec: LIST_ITEM,
      },
      { role: "bob", req: { method: "POST", path: "/api/useralbum/share/", body: { album_id: next, target_user_id: carol, shared: true } } },
      { role: "alice", req: { method: "POST", path: "/api/useralbum/share/", body: { album_id: 999999, target_user_id: carol, shared: true } } },
      { role: "alice", req: { method: "POST", path: "/api/useralbum/share/", body: { album_id: next, target_user_id: 999999, shared: true } } },
      { role: "bob", req: { path: "/api/albums/user/shared/tome/" }, spec: PAGE_OF_ITEMS },
      { role: "alice", req: { path: "/api/albums/user/shared/fromme/" }, spec: PAGE_OF_ITEMS },
      // Public link with an explicit slug, expiry and per-album options.
      {
        role: "alice",
        req: {
          method: "POST",
          path: "/api/useralbum/makepublic",
          body: {
            album_id: String(next),
            val_public: true,
            slug: "mutation-slug",
            expires_at: "2099-01-02T03:04:05.000Z",
            sharing_options: { share_location: true, share_timestamps: true, share_faces: null },
          },
        },
        spec: { project: ["status", ...LIST_ITEM.project.map(p => `album.${p}`)], unordered: ["album.shared_to"] },
      },
      { role: "anonymous", req: { path: `/api/albums/user/${next}/`, query: { public: "true" } }, spec: { project: ["*"], unordered: ["grouped_photos[].items"] } },
      { role: "alice", req: { method: "POST", path: "/api/useralbum/makepublic", body: { album_id: next, val_public: false } }, spec: { project: ["status", "album.public", "album.public_slug"] } },
      { role: "bob", req: { method: "POST", path: "/api/useralbum/makepublic", body: { album_id: next, val_public: true } } },
      { role: "alice", req: { method: "POST", path: "/api/useralbum/makepublic", body: { album_id: 999999, val_public: true } } },
      { role: "alice", req: { method: "POST", path: "/api/useralbum/makepublic", body: { album_id: next } } },
      // Delete (owner only).
      { role: "carol", req: { method: "DELETE", path: `/api/albums/user/${m.albums.user.unicode!.id}/` } },
      { role: "alice", req: { method: "DELETE", path: `/api/albums/user/${m.albums.user.unicode!.id}/` } },
      { role: "alice", req: { path: "/api/albums/user/list/" }, spec: { project: ["count", "results[].id", "results[].title", "results[].photo_count", "results[].cover_photo"] } },
    ]);
  });

  it("tags", async () => {
    const m = manifest();
    const next = Math.max(...m.tags.map(t => t.id)) + 1;
    const family = m.tags.find(t => t.name === "family")!;
    const trips = m.tags.find(t => t.name === "trips")!;
    const bobsTag = m.tags.find(t => t.owner === "bob")!;
    const steps: Step[] = [
      { role: "alice", req: { method: "POST", path: "/api/tags/", body: { name: "  mutation tag " } } },
      { role: "alice", req: { method: "POST", path: "/api/tags/", body: { name: "family" } } },
      { role: "alice", req: { method: "POST", path: "/api/tags/", body: { name: "" } } },
      { role: "alice", req: { method: "POST", path: "/api/tags/", body: {} } },
      { role: "alice", req: { method: "PATCH", path: `/api/tags/${next}/`, body: { name: "family" } } },
      { role: "alice", req: { method: "PATCH", path: `/api/tags/${next}/`, body: { name: "renamed tag" } } },
      { role: "bob", req: { method: "PATCH", path: `/api/tags/${next}/`, body: { name: "x" } } },
      { role: "alice", req: { method: "POST", path: `/api/tags/${next}/add/`, body: { photos: [id("alice/e2e_03"), hash("alice/e2e_04"), id("alice/hidden")] } } },
      { role: "alice", req: { method: "POST", path: `/api/tags/${next}/add/`, body: { photos: [id("bob/own_01")] } } },
      { role: "alice", req: { method: "POST", path: `/api/tags/${next}/add/`, body: { photos: [] } } },
      { role: "alice", req: { method: "POST", path: `/api/tags/${next}/add/`, body: { select_all: true, query: { video: true }, excluded_hashes: [] } } },
      { role: "alice", req: { method: "POST", path: `/api/tags/${next}/add/`, body: { select_all: true, query: { person: 999999 } } } },
      { role: "alice", req: { method: "POST", path: `/api/tags/${next}/remove/`, body: { photos: [hash("alice/e2e_03")] } } },
      { role: "alice", req: { method: "POST", path: `/api/tags/${next}/remove/`, body: { select_all: true, query: { video: true } } } },
      { role: "alice", req: { path: `/api/tags/${next}/` }, spec: { project: ["*"], unordered: ["results.grouped_photos[].items"] } },
      { role: "alice", req: { method: "POST", path: `/api/tags/${family.id}/merge/`, body: { tag: trips.id } } },
      { role: "alice", req: { method: "POST", path: `/api/tags/${family.id}/merge/`, body: { tag: family.id } } },
      { role: "alice", req: { method: "POST", path: `/api/tags/${family.id}/merge/`, body: { tag: bobsTag.id } } },
      { role: "alice", req: { method: "POST", path: `/api/tags/${family.id}/merge/`, body: { tag: "x" } } },
      { role: "alice", req: { method: "POST", path: `/api/tags/${family.id}/merge/`, body: {} } },
      { role: "bob", req: { method: "DELETE", path: `/api/tags/${next}/` } },
      // Which 4 of a tag's photos cover it is arbitrary in Django (sliced
      // prefetch, no ORDER BY) once a tag holds more than 4.
      { role: "alice", req: { path: "/api/tags/" }, spec: { project: ["count", "results[].id", "results[].name", "results[].photo_count"] } },
    ];
    await run(steps);
    const created = await call("alice", { path: `/api/tags/${next}/` });
    expect(created.status).toBe(200);
    const res = await call("alice", { method: "PATCH", path: `/api/tags/${next}/`, body: {} });
    expectSchema(Tag, res.body);
    await run([{ role: "alice", req: { method: "DELETE", path: `/api/tags/${m.tags.find(t => t.name === "sidecar-keyword")!.id}/` } }]);
  });

  it("auto albums", async () => {
    const m = manifest();
    const alices = m.albums.auto.filter(a => a.owner === "alice");
    await run([
      { role: "bob", req: { method: "DELETE", path: `/api/albums/auto/${alices[0]!.id}/` } },
      { role: "alice", req: { method: "DELETE", path: `/api/albums/auto/${alices[0]!.id}/` } },
      { role: "alice", req: { method: "DELETE", path: `/api/albums/auto/${alices[0]!.id}/` } },
      { role: "bob", req: { method: "POST", path: "/api/albums/auto/delete_all/" } },
      { role: "bob", req: { path: "/api/albums/auto/list/" } },
      { role: "alice", req: { path: "/api/albums/auto/list/" }, spec: { project: ["count", "results[].id"] } },
    ]);
  });

  // Viewset methods the frontend does not call (list/create on the album
  // viewset, the edit viewset's list/retrieve/PUT/DELETE, PUT on albums and
  // tags), and how makepublic reads expires_at.
  it("viewset methods and share expiry", async () => {
    const m = manifest();
    const vacation = m.albums.user.vacation!.id;
    const fixtureTag = m.tags.find(t => t.name === "Fixture")!;
    await run([
      { role: "alice", req: { method: "POST", path: "/api/albums/user/", body: { title: "Viewset Album" } }, spec: DETAIL },
      { role: "alice", req: { method: "POST", path: "/api/albums/user/", body: {} } },
      { role: "anonymous", req: { method: "POST", path: "/api/albums/user/", body: { title: "x" } } },
    ]);
    const edits = await call<{ results: { id: number; title: string }[] }>("alice", { path: "/api/albums/user/edit/" });
    const created = edits.body.results.find(a => a.title === "Viewset Album")!.id;
    await run([
      { role: "alice", req: { method: "PUT", path: `/api/albums/user/${created}/`, body: { title: "Viewset Album 2" } }, spec: DETAIL },
      { role: "alice", req: { method: "PUT", path: `/api/albums/user/${created}/`, body: {} } },
      { role: "carol", req: { method: "PUT", path: `/api/albums/user/${m.albums.user.shared_to_carol!.id}/`, body: { title: "mine" } } },
      { role: "alice", req: { method: "PUT", path: `/api/albums/user/edit/${created}/`, body: { title: "Viewset Album 3" } } },
      {
        role: "alice",
        req: { method: "PUT", path: `/api/albums/user/edit/${created}/`, body: { title: "Viewset Album 3", photos: [id("alice/e2e_03")] } },
        spec: EDIT,
      },
      { role: "alice", req: { path: `/api/albums/user/edit/${created}/` }, spec: EDIT },
      { role: "bob", req: { path: `/api/albums/user/edit/${created}/` } },
      { role: "alice", req: { path: "/api/albums/user/edit/" }, spec: { project: ["count", "results[].id", "results[].title", "results[].photos"], unordered: ["results[].photos"] } },
      {
        role: "alice",
        req: { path: "/api/albums/user/" },
        spec: { project: ["count", "results[].id", "results[].title", "results[].grouped_photos"], unordered: ["results[].grouped_photos[].items"] },
      },
      { role: "bob", req: { method: "DELETE", path: `/api/albums/user/edit/${created}/` } },
      { role: "alice", req: { method: "DELETE", path: `/api/albums/user/edit/${created}/` } },
      { role: "alice", req: { method: "PUT", path: `/api/tags/${fixtureTag.id}/`, body: {} } },
      { role: "alice", req: { method: "PUT", path: `/api/tags/${fixtureTag.id}/`, body: { name: "Fixture 2" } } },
      { role: "bob", req: { method: "PUT", path: `/api/tags/${fixtureTag.id}/`, body: { name: "x" } } },
      ...["2031-05-06T07:08:09Z", "2031-13-45T00:00", "2031-05-06 07:08", "soon"].map(expires_at => ({
        role: "alice" as Role,
        req: { method: "POST" as const, path: "/api/useralbum/makepublic", body: { album_id: vacation, val_public: true, expires_at } },
        spec: { project: ["status", "album.public", "album.public_expires_at"] },
      })),
      // Revoke again: the minted slugs are random on each side.
      { role: "alice", req: { method: "POST", path: "/api/useralbum/makepublic", body: { album_id: vacation, val_public: false } }, spec: { project: ["status", "album.public_expires_at"] } },
    ]);
  });
});
