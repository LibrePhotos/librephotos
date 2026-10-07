// `clip.embed` (batch_jobs.batch_calculate_clip_embedding) and
// `similarity.build` (image_similarity.build_image_similarity_index); port of
// lp_tasks::clip over in-process CLIP / similarity (src/ml) or the sidecars.
//
// The semantic model follows SEMANTIC_SEARCH_MODEL like librephotos-rs when
// CLIP runs in-process; the CLIP sidecar is ViT-B/32 only (settings.CLIP_ROOT),
// so through it every setting means ViT-B/32. Sidecar embeddings are stored
// with clip_embeddings_model NULL (Django's ViT-B/32), in-process ones with
// the model's name. Embeddings another model produced are re-embedded in
// place and left out of the index meanwhile.
import path from "node:path";
import { existsSync } from "node:fs";
import { config } from "../../lib/config";
import { client } from "../../lib/db";
import { MlFailed } from "../../ml/errors";
import { dataModels } from "../../ml/runtime";
import { clipInProcess, semanticModel, semanticSharesTagger, similarityInProcess } from "../../ml/clip/select";
import type { SemanticModel } from "../../ml/clip/model";
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

/** The stored model of api_photo.clip_embeddings in SQL (NULL = Django's ViT-B/32). */
const storedModelSql = (alias = "") => `coalesce(${alias}clip_embeddings_model, 'clip_vit_b32')`;

/**
 * `clip.embed`: embed the user's photos without an embedding of the semantic
 * model (none yet, or another model's), or all with `full`, page past every
 * batch whatever happens to it, then rebuild the similarity index; a failed
 * index build fails the job.
 */
export async function embed(userId: number, full: boolean, jobId: string): Promise<void> {
  // One model for the whole run, even if the setting changes meanwhile.
  const model = await semanticModel();
  const viaTagger = await semanticSharesTagger();
  const todo = `p.owner_id = $1 AND ($2 OR p.clip_embeddings IS NULL OR ${storedModelSql("p.")} <> $3)`;
  const [{ count, other }] = await client.unsafe(
    `SELECT count(*)::int AS count, (count(*) FILTER (WHERE p.clip_embeddings IS NOT NULL AND ${storedModelSql("p.")} <> $3))::int AS other
     FROM api_photo p WHERE ${todo}`,
    [userId, full, model],
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
    const batch: Missing[] = await client.unsafe(
      `SELECT p.id::text AS id, p.image_hash, t.thumbnail_big FROM api_photo p
       LEFT JOIN api_thumbnail t ON t.photo_id = p.id
       WHERE ${todo} AND ($4::uuid IS NULL OR p.id > $4::uuid)
       ORDER BY p.id LIMIT $5`,
      [userId, full, model, last, CLIP_BATCH],
    );
    if (!batch.length) break;
    // Page past this batch whatever happens to it: a photo that gets no
    // embedding still matches the filter.
    last = batch[batch.length - 1].id;
    done += batch.length;
    try {
      await storeBatch(batch, model, viaTagger);
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

interface Missing {
  id: string;
  image_hash: string;
  thumbnail_big: string | null;
}

interface Embeddings {
  imgs_emb: (ArrayLike<number> | null)[];
  magnitudes: (number | null)[];
}

/** The CLIP embeddings of `imgs` and the clip_embeddings_model to store them under. */
async function embedPaths(imgs: string[], model: SemanticModel, viaTagger: boolean): Promise<{ reply: Embeddings; column: string | null }> {
  if (viaTagger) {
    // The tagger's image tower (already loaded for tags.generate): no second
    // copy of the model in the CLIP slot. Sharing means the tagging model is `model`.
    const tags = await import("../../ml/tags/inprocess");
    const { l2Norm } = await import("../../ml/preprocess");
    const reply: Embeddings = { imgs_emb: [], magnitudes: [] };
    for (const img of imgs) {
      try {
        const e = await tags.imageEmbedding(img, model);
        reply.imgs_emb.push(e);
        reply.magnitudes.push(l2Norm(e));
      } catch (e) {
        if (!(e instanceof MlFailed)) throw e;
        console.warn(`clip embeddings: skipping unreadable image ${img}: ${e.message}`);
        reply.imgs_emb.push(null);
        reply.magnitudes.push(null);
      }
    }
    return { reply, column: model };
  }
  if (clipInProcess()) {
    const clip = await import("../../ml/clip/inprocess");
    return { reply: await clip.imageEmbeddings(imgs, path.join(dataModels(), model)), column: model };
  }
  return { reply: await sidecars.clipEmbeddings(imgs, clipModelDir()), column: null };
}

async function storeBatch(batch: Missing[], model: SemanticModel, viaTagger: boolean): Promise<void> {
  const valid = batch
    .filter((m) => m.thumbnail_big)
    .map((m) => ({ m, path: mediaPath(m.thumbnail_big!) }))
    .filter((v) => existsSync(v.path));
  if (!valid.length) return;
  const { reply, column } = await embedPaths(
    valid.map((v) => v.path),
    model,
    viaTagger,
  );
  const rowsOut: { id: string; e: number[]; m: number | null }[] = [];
  valid.forEach(({ m }, i) => {
    const emb = reply.imgs_emb[i];
    if (!emb) {
      console.warn(`No CLIP embedding for ${m.image_hash}: unreadable thumbnail`);
      return;
    }
    rowsOut.push({ id: m.id, e: Array.from(emb), m: reply.magnitudes[i] ?? null });
  });
  if (!rowsOut.length) return;
  await client`UPDATE api_photo p SET clip_embeddings = u.e, clip_embeddings_magnitude = u.m, clip_embeddings_model = ${column}, last_modified = now()
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
 * embeddings still sends one empty page so a stale index goes away). Only
 * the semantic model's embeddings go in. Returns the index size. One
 * rebuild at a time per process.
 */
export function buildIndex(userId: number): Promise<number> {
  const run = () => buildIndexPaged(userId, INDEX_PAGE_SIZE);
  const p = buildLock.then(run, run);
  buildLock = p.catch(() => undefined);
  return p;
}

type BuildPage = { user_id: number; image_hashes: string[]; image_embeddings: number[][]; begin: boolean; commit: boolean };

/** One page to the in-process index or the sidecar; the sidecar-shaped reply. */
async function sendPage(page: BuildPage, where: string): Promise<{ status?: unknown; index_size?: number | null; error?: string | null }> {
  if (similarityInProcess()) {
    const { similarityStore } = await import("../../ml/similarity/inprocess");
    try {
      return await similarityStore().build(page);
    } catch (e) {
      throw new Error(`${where} failed: ${(e as Error).message}`);
    }
  }
  try {
    return await sidecars.similarityBuild(page);
  } catch (e) {
    throw new Error(`${where} failed: ${e instanceof sidecars.SidecarError ? e.reason() : (e as Error).message}`);
  }
}

async function buildIndexPaged(userId: number, pageSize: number): Promise<number> {
  const model = await semanticModel();
  const ofModel = `${storedModelSql()} = $2`;
  const [{ username }] = await client`SELECT username FROM api_user WHERE id = ${userId}`;
  const [{ total }] = await client.unsafe(
    `SELECT count(*)::int AS total FROM api_photo WHERE owner_id = $1 AND NOT hidden AND clip_embeddings IS NOT NULL AND ${ofModel}`,
    [userId, model],
  );
  const pages = Math.max(1, Math.ceil(total / pageSize));
  let after: { hash: string; id: string } | null = null;
  let size = 0;
  for (let page = 0; page < pages; page++) {
    const rs: { id: string; image_hash: string; clip_embeddings: unknown }[] = await client.unsafe(
      `SELECT id::text AS id, image_hash, clip_embeddings FROM api_photo
       WHERE owner_id = $1 AND NOT hidden AND clip_embeddings IS NOT NULL AND ${ofModel}
         AND ($3::text IS NULL OR (image_hash, id) > ($3::text, $4::uuid))
       ORDER BY image_hash, id LIMIT $5`,
      [userId, model, after?.hash ?? null, after?.id ?? null, pageSize],
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
    const reply = await sendPage(
      { user_id: userId, image_hashes: hashes, image_embeddings: embeddings, begin: page === 0, commit: page + 1 === pages },
      where,
    );
    if (reply?.status !== true) {
      throw new Error(`${where} was refused: ${JSON.stringify(reply)}`);
    }
    size = typeof reply.index_size === "number" ? reply.index_size : 0;
  }
  return size;
}

/**
 * The startup `build_similarity_index` of the in-process index
 * (lp_tasks::clip::rebuild_stale_indices): rebuild every user's index that
 * is missing (e.g. the first start after the Python sidecar, whose files it
 * does not read) or holds another number of photos than the database has
 * embeddings of the semantic model. Returns how many were rebuilt.
 */
export async function rebuildStaleIndices(): Promise<number> {
  if (!similarityInProcess()) return 0;
  const { similarityStore } = await import("../../ml/similarity/inprocess");
  const model = await semanticModel();
  const users: { id: number; n: number }[] = await client.unsafe(
    `SELECT u.id, count(p.id)::int AS n FROM api_user u
     LEFT JOIN api_photo p ON p.owner_id = u.id AND NOT p.hidden
       AND p.clip_embeddings IS NOT NULL AND p.clip_embeddings <> '[]'::jsonb AND ${storedModelSql("p.")} = $1
     GROUP BY u.id ORDER BY u.id`,
    [model],
  );
  let rebuilt = 0;
  for (const { id, n } of users) {
    const stored = similarityStore().storedLen(id);
    if (stored === null ? n === 0 : stored === n) continue;
    try {
      await buildIndex(id);
      rebuilt++;
    } catch (e) {
      console.error(`similarity index rebuild of user ${id} failed: ${(e as Error).message}`);
    }
  }
  return rebuilt;
}

/** The embedding of a stored photo as the similarity search sends it, or null. */
export function storedEmbedding(v: unknown): number[] | null {
  const e = decodeEmbedding(v);
  return e ? toF32(e) : null;
}
