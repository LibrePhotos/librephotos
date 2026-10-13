import { z } from "zod";
import { ResponseParseError } from "../util/parse";
import type { ApiClient } from "./types";

/**
 * One answer of a list endpoint: a page (backend `api/drf/pagination.py`), or a
 * bare array from a list the server does not paginate. Rows stay `unknown`
 * here; callers parse them with the list's own schema.
 */
const ListAnswer = z.union([
  z.array(z.unknown()),
  z.object({
    results: z.array(z.unknown()),
    // Missing on a `{results}` envelope that is not a page: one page only.
    next: z.string().nullish(),
  }),
]);

/**
 * Every row of a paginated list: GET `endpoint`, then each page its `next`
 * names, until `next` is null (backend `api/drf/pagination.py`).
 *
 * Only the query string of `next` is used, appended to `endpoint`'s path: the
 * server builds `next` as an absolute URL from the request it saw, whose host
 * and scheme can be a reverse proxy's. That also follows an older server's
 * limit/offset `next` (`/api/user/` before #2327).
 *
 * A bare array (a list the server does not paginate) is returned as it is.
 * The rows are not parsed: callers parse them with the list's zod schema.
 */
export async function fetchAllPages(client: ApiClient, endpoint: string): Promise<unknown[]> {
  return (await fetchAllPagesWithFirst(client, endpoint)).rows;
}

/**
 * fetchAllPages, plus the first answer as the server sent it, for a list whose
 * page envelope carries more than the rows (the folder listing's own paths).
 * Neither is parsed.
 */
export async function fetchAllPagesWithFirst(
  client: ApiClient,
  endpoint: string
): Promise<{ first: unknown; rows: unknown[] }> {
  const path = endpoint.split("?")[0] ?? endpoint;
  const rows: unknown[] = [];
  const seen = new Set<string>();
  let first: unknown;
  let current: string | null = endpoint;
  while (current !== null) {
    if (seen.has(current)) {
      throw new ResponseParseError(endpoint, `next repeats ${current}`);
    }
    seen.add(current);
    const raw = await client.get<unknown>(current);
    if (current === endpoint) first = raw;
    const parsed = ListAnswer.safeParse(raw);
    if (!parsed.success) {
      throw new ResponseParseError(endpoint, "(root): expected a list or a page with results");
    }
    const answer = parsed.data;
    if (Array.isArray(answer)) return { first, rows: answer };
    rows.push(...answer.results);
    current = answer.next ? `${path}${new URL(answer.next, "http://next.invalid").search}` : null;
  }
  return { first, rows };
}
