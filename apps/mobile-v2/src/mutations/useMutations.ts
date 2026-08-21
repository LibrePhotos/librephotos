/**
 * App-facing offline-mutation actions. Each callback runs the pure optimistic
 * write (./actions) against the shared mirror DB — live queries re-fire on
 * commit so the UI updates instantly — then calls `notifyOutboxWrite()` so the
 * orchestrator replays the row (before the next delta pull) as soon as there's
 * connectivity. Screens/components call these; the pure functions stay
 * Node-tested and free of any expo/network import.
 */
import { useMemo } from "react";
import { useDb } from "@/db/provider";
import { useAuthStore } from "@/stores/auth";
import { notifyOutboxWrite } from "@/sync/triggers";
import type { AppDatabase } from "@/db/types";
import * as actions from "./actions";

export function useMutations() {
  const db = useDb();
  return useMemo(() => bindMutations(db), [db]);
}

/** Testable binder: wraps each action with the outbox-write trigger. */
export function bindMutations(db: AppDatabase, notify: (db: AppDatabase) => void = defaultNotify) {
  const after = <T>(result: T): T => {
    notify(db);
    return result;
  };
  return {
    favorite: (imageHashes: string[], favorite: boolean) =>
      after(actions.favoritePhotos(db, { imageHashes, favorite })),
    hide: (imageHashes: string[], hidden: boolean) =>
      after(actions.hidePhotos(db, { imageHashes, hidden })),
    trash: (imageHashes: string[], deleted: boolean) =>
      after(actions.trashPhotos(db, { imageHashes, deleted })),
    rate: (imageHash: string, rating: number) => after(actions.ratePhoto(db, { imageHash, rating })),
    caption: (imageHash: string, caption: string) =>
      after(actions.captionPhoto(db, { imageHash, caption })),
    addToAlbum: (albumId: number, title: string, photoIds: string[], imageHashes: string[]) =>
      after(actions.addPhotosToAlbum(db, { albumId, title, photoIds, imageHashes })),
    removeFromAlbum: (albumId: number, title: string, photoIds: string[], imageHashes: string[]) =>
      after(actions.removePhotosFromAlbum(db, { albumId, title, photoIds, imageHashes })),
    createAlbum: (title: string, photoIds: string[]) =>
      after(actions.createAlbum(db, { title, photoIds, ownerId: useAuthStore.getState().userId })),
    renameAlbum: (albumId: number, title: string) =>
      after(actions.renameAlbum(db, { albumId, title })),
    renamePerson: (personId: number, name: string) =>
      after(actions.renamePerson(db, { personId, name })),
  };
}

export type MutationActions = ReturnType<typeof bindMutations>;

function defaultNotify(db: AppDatabase): void {
  notifyOutboxWrite({ db, getUserId: () => useAuthStore.getState().userId });
}
