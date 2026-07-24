/**
 * Seed coordinator. Runs the full remote seed after login (when the mirror is
 * empty / never synced) and on pull-to-refresh (a forced re-seed; delta sync
 * lands in Phase 2). Keeps a single in-flight run and surfaces determinate
 * progress to the UI store.
 */
import type { ApiClient } from "@librephotos/api-client";
import { endpoints } from "@librephotos/api-client";
import type { AppDatabase } from "@/db/types";
import { getSyncState } from "@/db/queries/sync-state";
import { clearMirror } from "@/db/migrate";
import { seedAll, type SeedProgress } from "./remote/seed";
import { createApiSeedSource } from "./remote/seed-source";

export type SeedRunOptions = {
  userId: number;
  force?: boolean;
  onProgress?: (p: SeedProgress) => void;
};

let inFlight: Promise<void> | null = null;

/** Whether a first seed is still needed (mirror never fully synced). */
export function needsInitialSeed(db: AppDatabase): boolean {
  return getSyncState(db, "photo")?.status !== "done";
}

/**
 * Run the seed. Fetches the user's favorite_min_rating so is_favorite is
 * materialized correctly. `force` clears the mirror first (e.g. the favorite
 * threshold changed) for a clean re-seed.
 */
export async function runSeed(db: AppDatabase, client: ApiClient, opts: SeedRunOptions): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const user = await endpoints.fetchUserSelfDetails(client, opts.userId);
    if (opts.force) clearMirror(db);
    const source = createApiSeedSource(client);
    await seedAll(db, source, {
      ownerId: opts.userId,
      favoriteMinRating: user.favorite_min_rating,
      onProgress: opts.onProgress,
    });
  })();
  try {
    await inFlight;
  } finally {
    inFlight = null;
  }
}
