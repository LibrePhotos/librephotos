/**
 * Live contract test: runs the read endpoints against a real LibrePhotos
 * backend and lets the zod schemas judge the payloads. The fixtures in this
 * folder only prove the schemas match what the API looked like when they were
 * recorded; this proves they match the server in front of you.
 *
 * Opt-in, because it needs a running server with a scanned library:
 *
 *   LIBREPHOTOS_LIVE_URL=http://localhost:8000 \
 *   LIBREPHOTOS_LIVE_ACCESS=<access jwt> npx vitest run live.contract
 *
 * (or LIBREPHOTOS_LIVE_USER / LIBREPHOTOS_LIVE_PASSWORD instead of the token).
 */
import { describe, expect, it } from "vitest";

import { createApiClient, endpoints } from "../index";

const baseUrl = process.env.LIBREPHOTOS_LIVE_URL;
const username = process.env.LIBREPHOTOS_LIVE_USER;
const password = process.env.LIBREPHOTOS_LIVE_PASSWORD;

let access: string | null = process.env.LIBREPHOTOS_LIVE_ACCESS ?? null;

const client = createApiClient({
  baseUrl: baseUrl ?? "http://unused.invalid",
  tokens: {
    getAccessToken: () => access,
    getRefreshToken: () => null,
    setAccessToken: token => {
      access = token;
    },
    clearTokens: () => {
      access = null;
    },
  },
});

function userIdFromToken(token: string): string {
  const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));
  return String(payload.user_id);
}

describe.skipIf(!baseUrl)("live backend contract", () => {
  it("authenticates", async () => {
    if (!access && username && password) {
      access = (await endpoints.login(client, { username, password })).access;
    }
    expect(access).toBeTruthy();
  });

  it("user + site settings", async () => {
    await endpoints.fetchUserSelfDetails(client, userIdFromToken(access!));
    await endpoints.fetchSiteSettings(client);
  });

  it("timeline: date album list, one date album, photo detail", async () => {
    const groups = await endpoints.fetchDateAlbumsList(client);
    expect(groups.length).toBeGreaterThan(0);
    const group = await endpoints.fetchDateAlbum(client, String(groups[0]!.id), 1);
    expect(group.items.length).toBeGreaterThan(0);
    await endpoints.fetchPhotoDetails(client, group.items[0]!.id);
    await endpoints.fetchRecentlyAddedPhotos(client);
    await endpoints.fetchPhotosWithoutTimestamp(client, 1);
  });

  it("albums: user, auto, thing, place, tag (lists and first detail)", async () => {
    const user = await endpoints.fetchUserAlbumsList(client);
    if (user[0]) await endpoints.fetchUserAlbum(client, user[0].id);
    const auto = await endpoints.fetchAutoAlbumsList(client);
    if (auto[0]) await endpoints.fetchAutoAlbum(client, auto[0].id);
    const thing = await endpoints.fetchThingAlbumsList(client);
    if (thing[0]) await endpoints.fetchThingAlbum(client, thing[0].id);
    const place = await endpoints.fetchPlaceAlbumsList(client);
    if (place[0]) await endpoints.fetchPlaceAlbum(client, place[0].id);
    const tag = await endpoints.fetchTagAlbumsList(client);
    if (tag[0]) await endpoints.fetchTagAlbum(client, tag[0].id);
  });

  it("people + faces", async () => {
    await endpoints.fetchPeopleAlbums(client);
    await endpoints.fetchIncompleteFaces(client);
    await endpoints.fetchFaces(client);
  });

  it("search", async () => {
    await endpoints.searchPhotos(client, "tram");
  });

  it("sharing", async () => {
    await endpoints.fetchSharedPhotosByMe(client);
    await endpoints.fetchSharedPhotosWithMe(client);
    await endpoints.fetchSharedAlbumsByMe(client);
    await endpoints.fetchSharedAlbumsWithMe(client);
  });

  it("jobs", async () => {
    await endpoints.fetchJobs(client);
    await endpoints.fetchWorkerAvailability(client);
  });

  it("delta sync feeds + counts", async () => {
    await endpoints.syncPhotos(client);
    await endpoints.syncPersons(client);
    await endpoints.syncUserAlbums(client);
    await endpoints.syncAutoAlbums(client);
    await endpoints.syncThingAlbums(client);
    await endpoints.syncPlaceAlbums(client);
    await endpoints.syncTagAlbums(client);
    await endpoints.syncSharing(client);
    await endpoints.syncCounts(client);
  });
});
