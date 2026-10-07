// `clip.embed` (batch_jobs.batch_calculate_clip_embedding) and
// `similarity.build` (image_similarity.build_image_similarity_index); port of
// lp_tasks::clip over the CLIP and similarity sidecars.
//
// Django's CLIP sidecar is ViT-B/32 only (settings.CLIP_ROOT), so TS
// embeds with that model whatever SEMANTIC_SEARCH_MODEL says (a Rust-only
// setting). Embeddings are stored with clip_embeddings_model NULL, which
// Rust reads as Django's ViT-B/32; embeddings another model produced (Rust's
// MobileCLIP) are re-embedded in place and left out of the index meanwhile.
import path from "node:path";
import { existsSync } from "node:fs";
import { config } from "../../lib/config";
import { client } from "../../lib/db";
import { complete, fail, setProgress } from "./run";
import { mediaPath } from "./photos";
import * as sidecars from "./sidecars";

/** Photos per CLIP request (BATCH_SIZE). */
const CLIP_BATCH = 64;
/** Embeddings per similarity /build/ request (INDEX_PAGE_SIZE). */
const INDEX_PAGE_SIZE = 5000;
/**
 * Index rebuilds while a long clip.embed runs: the first after this many
 * photos, then each time as many photos were embedded as the index held.
 */
const REINDEX_MIN = 2000;

/** settings.CLIP_ROOT: the model directory the CLIP sidecar is told to use. */
export const clipModelDir = () => path.join(config.mediaRoot, "data_models", "clip_vit_b32");

/** Embeddings this model's index takes (NULL = Django's ViT-B/32). */
const STORED_IS_CLIP = "coalesce(clip_embeddings_model, 'clip_vit_b32') = 'clip_vit_b32'";

/**
 * `clip.embed`: embed the user's photos without a ViT-B/32 embedding (or all
 * with `full`), page past every batch whatever happens to it, then rebuild
 * the similarity index; a failed index build fails the job.
 */
export async function embed(userId: number, full: boolean, jobId: string): Promise<void> {
  const notClip = `NOT (${STORED_IS_CLIP.replaceAll("clip_embeddings_model", "p.clip_embeddings_model")})`;
  const [{ count, other }] = await client.unsafe(
    `SELECT count(*)::int AS count, (count(*) FILTER (WHERE p.clip_embeddings IS NOT NULL AND ${notClip}))::int AS other
     FROM api_photo p WHERE p.owner_id = $1 AND ($2 OR p.clip_embeddings IS NULL OR ${notClip})`,
    [userId, full],
  );
  await setProgress(jobId, 0, count);
  if (other > 0) {
    // The index may still hold the other model's embeddings: from now on it holds only this model's.
    try {
      await buildIndex(userId);
    } catch (e) {
      console.error(`Error building the similarity index: ${(e as Error).message}`);
    }
  }
  let done = 0;
  let builtAt = 0;
  let builtSize = 0;
  let last: string | null = null;
  while (done < count) {
    const batch: { id: string; image_hash: string; thumbnail_big: string | null }[] = await client.unsafe(
      `SELECT p.id::text AS id, p.image_hash, t.thumbnail_big FROM api_photo p
       LEFT JOIN api_thumbnail t ON t.photo_id = p.id
       WHERE p.owner_id = $1 AND ($2 OR p.clip_embeddings IS NULL OR ${notClip}) AND ($3::uuid IS NULL OR p.id > $3::uuid)
       ORDER BY p.id LIMIT $4`,
      [userId, full, last, CLIP_BATCH],
    );
    if (!batch.length) break;
    // Page past this batch whatever happens to it: a photo that gets no
    // embedding still matches the filter.
    last = batch[batch.length - 1].id;
    done += batch.length;
    try {
      await storeBatch(batch);
    } catch (e) {
      console.error(`Error calculating clip embeddings: ${(e as Error).message}`);
    }
    await setProgress(jobId, done, count);
    if (done < count && done - builtAt >= Math.max(builtSize, REINDEX_MIN)) {
      try {
        builtSize = await buildIndex(userId);
      } catch (e) {
        console.error(`Error building the similarity index: ${(e as Error).message}`);
      }
      builtAt = done;
    }
  }
  try {
    await buildIndex(userId);
  } catch (e) {
    // The embeddings are stored; only the index is stale.
    await fail(jobId, (e as Error).message);
    throw e;
  }
  await complete(jobId);
}

async function storeBatch(batch: { id: string; image_hash: string; thumbnail_big: string | null }[]): Promise<void> {
  const valid = batch
    .filter((m) => m.thumbnail_big)
    .map((m) => ({ m, path: mediaPath(m.thumbnail_big!) }))
    .filter((v) => existsSync(v.path));
  if (!valid.length) return;
  const reply = await sidecars.clipEmbeddings(
    valid.map((v) => v.path),
    clipModelDir(),
  );
  const rowsOut: { id: string; e: number[]; m: number | null }[] = [];
  valid.forEach(({ m }, i) => {
    const emb = reply.imgs_emb[i];
    if (!emb) {
      console.warn(`No CLIP embedding for ${m.image_hash}: unreadable thumbnail`);
      return;
    }
    rowsOut.push({ id: m.id, e: emb, m: reply.magnitudes[i] ?? null });
  });
  if (!rowsOut.length) return;
  await client`UPDATE api_photo p SET clip_embeddings = u.e, clip_embeddings_magnitude = u.m, clip_embeddings_model = NULL, last_modified = now()
    FROM jsonb_to_recordset(${JSON.stringify(rowsOut)}::text::jsonb) AS u(id uuid, e jsonb, m float8) WHERE p.id = u.id`;
}

/** get_clip_embeddings(): the list, or the list in a JSON string; null for anything else or an empty list. */
function decodeEmbedding(v: unknown): number[] | null {
  let e = v;
  if (typeof e === "string") {
    try {
      e = JSON.parse(e);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(e) || !e.length || e.some((x) => typeof x !== "number")) return null;
  return e as number[];
}

/** numpy float32 round trip: what `np.array(emb, dtype=np.float32).tolist()` sends. */
export const toF32 = (v: number[]) => Array.from(Float32Array.from(v));

let buildLock: Promise<unknown> = Promise.resolve();

/**
 * Rebuild the user's similarity index: pages of 5000 photos sent as one
 * rebuild (begin on the first, commit on the last; a user without
 * embeddings still sends one empty page so a stale index goes away).
 * Returns the index size. One rebuild at a time per process.
 */
export function buildIndex(userId: number): Promise<number> {
  const run = () => buildIndexPaged(userId, INDEX_PAGE_SIZE);
  const p = buildLock.then(run, run);
  buildLock = p.catch(() => undefined);
  return p;
}

async function buildIndexPaged(userId: number, pageSize: number): Promise<number> {
  const [{ username }] = await client`SELECT username FROM api_user WHERE id = ${userId}`;
  const [{ total }] = await client.unsafe(
    `SELECT count(*)::int AS total FROM api_photo WHERE owner_id = $1 AND NOT hidden AND clip_embeddings IS NOT NULL AND ${STORED_IS_CLIP}`,
    [userId],
  );
  const pages = Math.max(1, Math.ceil(total / pageSize));
  let after: { hash: string; id: string } | null = null;
  let size = 0;
  for (let page = 0; page < pages; page++) {
    const rs: { id: string; image_hash: string; clip_embeddings: unknown }[] = await client.unsafe(
      `SELECT id::text AS id, image_hash, clip_embeddings FROM api_photo
       WHERE owner_id = $1 AND NOT hidden AND clip_embeddings IS NOT NULL AND ${STORED_IS_CLIP}
         AND ($2::text IS NULL OR (image_hash, id) > ($2::text, $3::uuid))
       ORDER BY image_hash, id LIMIT $4`,
      [userId, after?.hash ?? null, after?.id ?? null, pageSize],
    );
    if (rs.length) after = { hash: rs[rs.length - 1].image_hash, id: rs[rs.length - 1].id };
    const hashes: string[] = [];
    const embeddings: number[][] = [];
    for (const r of rs) {
      const e = decodeEmbedding(r.clip_embeddings);
      if (e) {
        hashes.push(r.image_hash);
        embeddings.push(toF32(e));
      }
    }
    const where = `page ${page + 1} of ${pages} of the similarity index of ${username}`;
    let reply: Awaited<ReturnType<typeof sidecars.similarityBuild>>;
    try {
      reply = await sidecars.similarityBuild({
        user_id: userId,
        image_hashes: hashes,
        image_embeddings: embeddings,
        begin: page === 0,
        commit: page + 1 === pages,
      });
    } catch (e) {
      throw new Error(`${where} failed: ${e instanceof sidecars.SidecarError ? e.reason() : (e as Error).message}`);
    }
    if (reply?.status !== true) {
      throw new Error(`${where} was refused: ${JSON.stringify(reply)}`);
    }
    size = typeof reply.index_size === "number" ? reply.index_size : 0;
  }
  return size;
}

/** The embedding of a stored photo as the similarity search sends it, or null. */
export function storedEmbedding(v: unknown): number[] | null {
  const e = decodeEmbedding(v);
  return e ? toF32(e) : null;
}
