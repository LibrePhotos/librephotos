/**
 * @jest-environment node
 */
import { createApiClient, type TokenSupplier } from "@librephotos/api-client";
import { createTestDb, type TestDb } from "@/db/test-db";
import { remotePhoto, seedRemotePhotos } from "@/db/__tests__/fixtures";
import { setMetaNumber, META_FAVORITE_MIN_RATING } from "@/db/queries/app-meta";
import { ratePhoto } from "@/mutations/actions";
import { pendingOutboxCount } from "@/mutations/outbox";
import { createApiOutboxExecutor } from "../outbox/executor";
import { drainOutbox, type ReplayToast } from "../outbox/replay";

// The executor module wires the app singletons; this test hands it its own
// client, so neither the secure-store-backed client nor the toast store loads.
jest.mock("@/lib/apiClient", () => ({ apiClient: {} }));
jest.mock("@/stores/toasts", () => ({ useToastStore: { getState: () => ({ push: () => {} }) } }));

const tokens: TokenSupplier = {
  getAccessToken: () => "test-access",
  getRefreshToken: () => "test-refresh",
  setAccessToken: () => {},
  clearTokens: () => {},
};

type Call = { url: string; method?: string; body: unknown };

function serverReplying(status: number, body: unknown) {
  const calls: Call[] = [];
  const fetchMock = ((input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), method: init?.method, body: JSON.parse(String(init?.body)) });
    return Promise.resolve(
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
    );
  }) as typeof fetch;
  const client = createApiClient({ baseUrl: "https://demo.example.com", tokens, fetch: fetchMock });
  return { executor: createApiOutboxExecutor(client), calls };
}

describe("outbox executor: rating", () => {
  let t: TestDb;
  beforeEach(() => {
    t = createTestDb();
    setMetaNumber(t.db, META_FAVORITE_MIN_RATING, 4);
    seedRemotePhotos(t.db, [remotePhoto({ id: "p1", imageHash: "hA", rating: 0 })]);
  });
  afterEach(() => t.close());

  // PATCH /photos/edit/{hash}/ answered 200 and dropped `rating`, so the phone
  // kept a rating the server never stored.
  it("replays a rating through POST /photosedit/rating/", async () => {
    ratePhoto(t.db, { imageHash: "hA", rating: 3 });
    const { executor, calls } = serverReplying(200, {
      status: true,
      count: 1,
      updated_hashes: ["hA"],
      not_updated_hashes: [],
    });

    const res = await drainOutbox(t.db, executor, { now: () => 1000 });

    expect(calls).toEqual([
      {
        url: "https://demo.example.com/api/photosedit/rating/",
        method: "POST",
        body: { image_hashes: ["hA"], rating: 3 },
      },
    ]);
    expect(res).toMatchObject({ replayed: 1, dropped: 0, remaining: 0 });
    expect(pendingOutboxCount(t.db)).toBe(0);
  });

  it("drops the rating with a toast when the server has no rating endpoint", async () => {
    ratePhoto(t.db, { imageHash: "hA", rating: 5 });
    const { executor } = serverReplying(404, { detail: "Not found." });
    const toasts: ReplayToast[] = [];

    const res = await drainOutbox(t.db, executor, { now: () => 1000, onToast: (x) => toasts.push(x) });

    expect(res).toMatchObject({ replayed: 0, dropped: 1, remaining: 0 });
    expect(toasts.map((x) => x.kind)).toEqual(["rating"]);
  });
});
