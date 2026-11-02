import { useCallback } from "react";
import { sql } from "drizzle-orm";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { albumKeys, endpoints, faceKeys, photoGridKeys, Photoset, useApiClient } from "@librephotos/api-client";
import { useDb } from "@/db/provider";
import { deletePersons } from "@/db/writers";
import { useAuthStore } from "@/stores/auth";
import { useToastStore } from "@/stores/toasts";
import { runSync } from "@/sync/run";

/**
 * The person page's online actions (the web's PersonHeaderMenu and "Remove from
 * person"): set the cover, merge into another person, delete the person, take
 * the person off photos. None of them has an outbox kind — the mirror cannot
 * stand in for a merge or a face going back to unknown — so they talk to the
 * server, write what they can to the mirror at once, refresh the online queries
 * and run a delta sync for the rest. Each answers whether it worked; failures
 * surface as toasts. Rename is not here: it goes through the outbox
 * (`person_rename`) and works offline.
 */
export function usePersonActions(personId: number) {
  const { t } = useTranslation();
  const client = useApiClient();
  const db = useDb();
  const queryClient = useQueryClient();
  const userId = useAuthStore((s) => s.userId);
  const pushToast = useToastStore((s) => s.push);

  /** The person's photos, the people list, the faces: everything a person change moves. */
  const refresh = useCallback(() => {
    for (const queryKey of [
      photoGridKeys.dateAlbumLists(Photoset.PERSON),
      albumKeys.peopleAlbums(),
      faceKeys.personFaces(),
      faceKeys.incomplete(),
    ]) {
      void queryClient.invalidateQueries({ queryKey });
    }
    if (userId != null) void runSync(db, { userId, reason: "manual" });
  }, [queryClient, db, userId]);

  const setCover = useCallback(
    async (imageHash: string): Promise<boolean> => {
      try {
        // The server takes an image hash or a photo UUID; the hash works on every version.
        await endpoints.setPersonCover(client, personId, imageHash);
        db.run(sql`UPDATE person SET cover_photo_hash = ${imageHash} WHERE id = ${personId}`);
        pushToast({ level: "info", message: t("person.coverSet") });
        refresh();
        return true;
      } catch {
        pushToast({ level: "error", message: t("person.coverFailed") });
        return false;
      }
    },
    [client, db, personId, pushToast, t, refresh]
  );

  /** Merge this person into `target`: this person's faces move there and this person is gone. */
  const mergeInto = useCallback(
    async (target: { id: number; name: string }): Promise<boolean> => {
      try {
        await endpoints.mergePerson(client, target.id, personId);
        deletePersons(db, [personId]);
        pushToast({ level: "info", message: t("person.merged", { name: target.name }) });
        refresh();
        return true;
      } catch {
        pushToast({ level: "error", message: t("person.mergeFailed") });
        return false;
      }
    },
    [client, db, personId, pushToast, t, refresh]
  );

  const deletePerson = useCallback(
    async (name: string): Promise<boolean> => {
      try {
        await endpoints.deletePerson(client, personId);
        deletePersons(db, [personId]);
        pushToast({ level: "info", message: t("person.deleted", { name }) });
        refresh();
        return true;
      } catch {
        pushToast({ level: "error", message: t("person.deleteFailed") });
        return false;
      }
    },
    [client, db, personId, pushToast, t, refresh]
  );

  /** Take the person off photos (by `Photo.id`): their faces on them go back to unknown. */
  const removePhotos = useCallback(
    async (photoIds: string[], name: string): Promise<boolean> => {
      if (photoIds.length === 0) return false;
      try {
        const result = await endpoints.removePhotosFromPerson(client, personId, photoIds);
        pushToast({ level: "info", message: t("person.removed", { count: result.photo_count, name }) });
        refresh();
        return true;
      } catch {
        pushToast({ level: "error", message: t("person.removeFailed") });
        return false;
      }
    },
    [client, personId, pushToast, t, refresh]
  );

  return { setCover, mergeInto, deletePerson, removePhotos };
}
