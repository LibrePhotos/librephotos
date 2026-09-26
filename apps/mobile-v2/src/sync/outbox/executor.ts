/**
 * App wiring for outbox replay: builds a real {@link OutboxExecutor} over the
 * api-client mutation endpoints and exposes `replayOutbox` for the
 * `outbox_replay` job seam. Imports the app api-client singleton, so this module
 * is never pulled into the Node test project — the pure `drainOutbox` core in
 * ./replay is what the unit tests exercise.
 */
import { endpoints } from "@librephotos/api-client";
import type { AppDatabase } from "@/db/types";
import { apiClient } from "@/lib/apiClient";
import { useToastStore } from "@/stores/toasts";
import { drainOutbox, type DrainOptions, type OutboxExecutor, type OutboxReplayResult } from "./replay";

export function createApiOutboxExecutor(client = apiClient): OutboxExecutor {
  return {
    favorite: async (p) => {
      await endpoints.setPhotosFavorite(client, p.imageHashes, p.favorite);
    },
    hide: async (p) => {
      await endpoints.setPhotosHidden(client, p.imageHashes, p.hidden);
    },
    trash: async (p) => {
      await endpoints.setPhotosDeleted(client, p.imageHashes, p.deleted);
    },
    rating: async (p) => {
      await endpoints.setPhotoRating(client, p.imageHash, p.rating);
    },
    caption: async (p) => {
      await endpoints.savePhotoCaption(client, p.imageHash, p.caption);
    },
    albumAdd: async (p) => {
      await endpoints.addPhotosToUserAlbum(client, p.albumId, p.title, p.photoIds);
    },
    albumRemove: async (p) => {
      await endpoints.removePhotosFromUserAlbum(client, p.albumId, p.imageHashes);
    },
    albumCreate: async (p) => {
      const res = await endpoints.createUserAlbum(client, p.title, p.photoIds);
      return { id: res.id };
    },
    albumRename: async (p) => {
      await endpoints.renameUserAlbum(client, p.albumId, p.title);
    },
    personRename: async (p) => {
      await endpoints.renamePerson(client, p.personId, p.name);
    },
  };
}

let executor: OutboxExecutor | null = null;

/**
 * The `outbox_replay` job's body — drain a bounded slice of the outbox through
 * the real endpoints. Bounded because the job contract is "finish well under a
 * second"; the handler re-enqueues while rows remain.
 */
export async function replayOutbox(
  db: AppDatabase,
  opts: Pick<DrainOptions, "signal" | "log" | "maxRows"> = {}
): Promise<OutboxReplayResult> {
  executor ??= createApiOutboxExecutor();
  return drainOutbox(db, executor, {
    ...opts,
    onToast: (t) => useToastStore.getState().push({ level: t.level, message: t.message }),
  });
}
