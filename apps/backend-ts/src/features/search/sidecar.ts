// The CLIP and similarity sidecar calls of semantic search and "similar
// photos" (api/semantic_search.py calculate_query_embeddings,
// api/image_similarity.py search_similar_embedding / search_similar_image;
// call policy of api/sidecars.py, port of lp_sidecars::client).
//
// TS talks only to the Python sidecars, whose CLIP is ViT-B/32 (Django's
// CLIP_ROOT), so the semantic model is always clip_vit_b32: the same choice
// librephotos-rs makes when CLIP is not in-process.
import path from "node:path";
import { config } from "~/lib/config";

export const SEMANTIC_MODEL = "clip_vit_b32";
/** search_similar_embedding's cut for ViT-B/32. */
export const SEARCH_THRESHOLD = 27;
/** The photo detail's similar-photos cut for ViT-B/32. */
export const SIMILAR_THRESHOLD = 90;

/** Whether an embedding stored with this clip_embeddings_model is in the ViT-B/32 index (NULL = Django's). */
export const sidecarSemanticModelProduced = (column: string | null) => column === null || column === SEMANTIC_MODEL;

export class SidecarError extends Error {
  constructor(
    message: string,
    /** HTTP status for an error answer; undefined when unreachable/timed out/bad body. */
    public status?: number,
  ) {
    super(message);
  }
}

/** Three attempts in all for refused connections and 503s, 0 s then 1 s apart; a timeout is never retried. */
const RETRY_DELAYS_MS = [0, 1000];
const CONNECT_TIMEOUT_MS = 5000;

async function postJson<T>(name: string, port: number, urlPath: string, body: unknown, readSecs: number): Promise<T> {
  const url = config.sidecar(name, port).replace(/\/$/, "") + urlPath;
  const payload = JSON.stringify(body);
  let lastError = "";
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0 && RETRY_DELAYS_MS[attempt - 1] > 0) await Bun.sleep(RETRY_DELAYS_MS[attempt - 1]);
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS + readSecs * 1000),
      });
    } catch (e) {
      const err = e as Error;
      if (err.name === "TimeoutError") throw new SidecarError(`${name} sidecar timed out after ${readSecs} s at ${url}`);
      lastError = err.message;
      continue;
    }
    if (res.status === 503 && attempt < RETRY_DELAYS_MS.length) {
      await res.arrayBuffer().catch(() => undefined);
      continue;
    }
    const text = await res.text();
    if (res.status < 200 || res.status >= 300) {
      let detail = text.trim() || "<empty body>";
      try {
        const j = JSON.parse(text);
        if (j && typeof j === "object" && typeof j.error === "string" && j.error) detail = j.error;
      } catch {
        // not JSON
      }
      throw new SidecarError(`${name} sidecar returned status ${res.status} for ${url}: ${detail.slice(0, 500)}`, res.status);
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new SidecarError(`${name} sidecar returned an unusable reply for ${url}`);
    }
  }
  throw new SidecarError(`${name} sidecar unreachable at ${url}: ${lastError}`);
}

/**
 * Image hashes of `userId`'s index closest to `embedding`. An error status
 * of the sidecar is "no hits" (logged); other failures throw when `strict`
 * (semantic search: a 500 like Django) and are "no hits" otherwise (the
 * photo detail must still render).
 */
export async function similarityHashes(
  userId: number,
  embedding: number[],
  n: number | null,
  threshold: number,
  strict: boolean,
): Promise<string[]> {
  const body: Record<string, unknown> = { user_id: userId, image_embedding: embedding, threshold };
  if (n !== null) body.n = n;
  try {
    const reply = await postJson<{ result?: unknown }>("similarity", 8002, "/search/", body, 60);
    return Array.isArray(reply.result) ? reply.result.filter((h): h is string => typeof h === "string") : [];
  } catch (e) {
    if (e instanceof SidecarError && e.status !== undefined) {
      console.error(`error retrieving similar embeddings for user ${userId}: status ${e.status}`);
      return [];
    }
    if (strict) throw e;
    return [];
  }
}

/** The CLIP text embedding of `query` (any failure throws). */
export async function queryEmbedding(query: string): Promise<number[]> {
  const model = path.join(config.mediaRoot, "data_models", SEMANTIC_MODEL);
  const reply = await postJson<{ emb?: unknown }>("clip", 8006, "/query-embeddings", { query, model }, 120);
  if (!Array.isArray(reply.emb) || !reply.emb.every((x) => typeof x === "number")) {
    throw new SidecarError("clip sidecar returned an unusable reply");
  }
  return reply.emb as number[];
}
