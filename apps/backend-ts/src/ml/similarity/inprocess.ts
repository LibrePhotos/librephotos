// In-process similarity index (port of lp_ml::similarity::inprocess, which
// replaces the image_similarity sidecar): one flat inner-product index per
// user, persisted under MEDIA_ROOT/similarity in librephotos-rs's format.
//
// Searches stat the user's file and reload it when it changed, so an index
// rebuilt by another process (a worker, or librephotos-rs) is picked up. A
// user without a file has no similar photos (rebuildStaleIndices in
// features/tasks/clip.ts rebuilds missing or outdated ones at startup).
import { unlinkSync } from "node:fs";
import path from "node:path";
import { config } from "../../lib/config";
import { MlFailed } from "../errors";
import { FlatIndex, indexPath, stamp, storedLen } from "./index";

/** Set once the port passes its goldens; `auto` mode then uses it. */
export const IMPLEMENTED = true;

/** `n` when the caller gives none (the sidecar's default). */
export const DEFAULT_N = 100;

export interface BuildPage {
  user_id: number;
  image_hashes: string[];
  image_embeddings: ArrayLike<number>[];
  begin: boolean;
  commit: boolean;
}

export class SimilarityStore {
  private live = new Map<number, { index: FlatIndex; stamp: string }>();
  private staging = new Map<number, FlatIndex>();
  /** Serializes writers (builds, deletes). */
  private writeLock: Promise<unknown> = Promise.resolve();

  constructor(readonly dir: string) {}

  path(userId: number) {
    return indexPath(this.dir, userId);
  }

  /** The user's index as on disk now, loading it when new or changed. */
  current(userId: number): FlatIndex | null {
    const file = this.path(userId);
    const now = stamp(file);
    if (now === null) {
      this.live.delete(userId);
      return null;
    }
    const l = this.live.get(userId);
    if (l && l.stamp === now) return l.index;
    const index = FlatIndex.read(file);
    console.info(`loaded the similarity index of user ${userId} (${index.length} photos)`);
    this.live.set(userId, { index, stamp: now });
    return index;
  }

  /** Write `index` and make it the live one. */
  private install(userId: number, index: FlatIndex): number {
    const file = this.path(userId);
    index.write(file);
    const now = stamp(file);
    if (now === null) throw new Error(`${file} vanished`);
    this.live.set(userId, { index, stamp: now });
    return index.length;
  }

  private exclusive<T>(f: () => T): Promise<T> {
    const run = async () => f();
    const p = this.writeLock.then(run, run);
    this.writeLock = p.catch(() => undefined);
    return p;
  }

  /**
   * POST /build/: a paged rebuild (`begin` on the first page, `commit` on
   * the last, staged until commit), or without either and no rebuild
   * running an incremental add to the live index. A bad page abandons the
   * rebuild (400) and leaves the live index in place.
   */
  build(page: BuildPage): Promise<{ status: true; index_size: number }> {
    return this.exclusive(() => {
      const userId = page.user_id;
      const refused = (e: unknown) => {
        const message = `rebuild for user ${userId} abandoned: ${(e as Error).message}`;
        console.error(message);
        return new MlFailed(400, message);
      };
      const failed = (e: unknown) => new MlFailed(500, (e as Error).message);
      if (!(page.begin || page.commit || this.staging.has(userId))) {
        let idx: FlatIndex | null;
        try {
          idx = this.current(userId);
        } catch (e) {
          throw failed(e);
        }
        if (!page.image_embeddings.length) return { status: true, index_size: idx?.length ?? 0 };
        const next = new FlatIndex(0);
        if (idx) for (let i = 0; i < idx.length; i++) next.add([idx.hashes[i]], [idx.vector(i)]);
        try {
          next.add(page.image_hashes, page.image_embeddings);
        } catch (e) {
          throw new MlFailed(400, (e as Error).message);
        }
        try {
          return { status: true, index_size: this.install(userId, next) };
        } catch (e) {
          throw failed(e);
        }
      }
      if (page.begin) {
        console.info(`rebuilding the similarity index of user ${userId}`);
        this.staging.set(userId, new FlatIndex(0));
      }
      const staged = this.staging.get(userId);
      if (!staged) throw refused(new Error(`no rebuild in progress for user ${userId}`));
      if (page.image_embeddings.length) {
        try {
          staged.add(page.image_hashes, page.image_embeddings);
        } catch (e) {
          this.staging.delete(userId);
          throw refused(e);
        }
      }
      if (!page.commit) return { status: true, index_size: staged.length };
      this.staging.delete(userId);
      let size: number;
      try {
        size = this.install(userId, staged);
      } catch (e) {
        throw failed(e);
      }
      console.info(`similarity index of user ${userId} rebuilt (${size} photos)`);
      return { status: true, index_size: size };
    });
  }

  /** POST /search/: image hashes, best first; no index = no hits. */
  search(userId: number, embedding: ArrayLike<number>, n: number | null, threshold: number): string[] {
    try {
      const idx = this.current(userId);
      return idx ? idx.search(embedding, n ?? DEFAULT_N, threshold) : [];
    } catch (e) {
      console.error(`similarity search for user ${userId} failed: ${(e as Error).message}`);
      throw new MlFailed(500, (e as Error).message);
    }
  }

  /** DELETE /build/. */
  delete(userId: number): Promise<{ status: true }> {
    return this.exclusive(() => {
      this.live.delete(userId);
      this.staging.delete(userId);
      try {
        unlinkSync(this.path(userId));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw new MlFailed(500, (e as Error).message);
      }
      return { status: true as const };
    });
  }

  /** Vectors in the stored index of `userId` (null when none or unreadable). */
  storedLen(userId: number): number | null {
    return storedLen(this.path(userId));
  }
}

let store: SimilarityStore | null = null;

/** The process-wide store under MEDIA_ROOT/similarity. */
export const similarityStore = () => (store ??= new SimilarityStore(path.join(config.mediaRoot, "similarity")));
