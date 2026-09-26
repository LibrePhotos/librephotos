import { createApiClient, endpoints, squareThumbnailUrl } from "@librephotos/api-client";
import { fakeTokens } from "@/test/test-utils";

/**
 * Integration test: the shared api-client transport + endpoints + zod schemas
 * against a mocked fetch, exercised the way the mobile app consumes them. Proves
 * the source-imported workspace package resolves and round-trips real payloads.
 */
describe("api-client integration (mocked fetch)", () => {
  it("attaches the bearer token, hits /api, and parses the timeline payload", async () => {
    const calls: string[] = [];
    const fetchMock = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer test-access");
      return Promise.resolve(
        new Response(
          JSON.stringify({
            date: "2024-06-15",
            results: [{ id: "11111111-1111-1111-1111-111111111111", image_hash: "hashA", aspectRatio: 1.5, type: "image", rating: 0 }],
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      );
    }) as typeof fetch;

    const client = createApiClient({ baseUrl: "https://demo.example.com", tokens: fakeTokens(), fetch: fetchMock });

    const data = await endpoints.fetchRecentlyAddedPhotos(client);

    expect(calls[0]).toBe("https://demo.example.com/api/photos/recentlyadded/");
    expect(data.results).toHaveLength(1);
    expect(data.results[0].image_hash).toBe("hashA");
    // zod defaults applied
    expect(data.results[0].isTemp).toBe(false);
  });

  it("builds media thumbnail URLs under /media (not /api)", () => {
    expect(squareThumbnailUrl("https://demo.example.com", "hashA")).toBe(
      "https://demo.example.com/media/square_thumbnails/hashA"
    );
  });

  it("surfaces malformed payloads as thrown errors (schema contract)", async () => {
    const fetchMock = (() =>
      Promise.resolve(
        new Response(JSON.stringify({ results: "not-an-array" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      )) as typeof fetch;
    const client = createApiClient({ baseUrl: "https://demo.example.com", tokens: fakeTokens(), fetch: fetchMock });

    await expect(endpoints.fetchRecentlyAddedPhotos(client)).rejects.toThrow(/Failed to parse/);
  });
});
