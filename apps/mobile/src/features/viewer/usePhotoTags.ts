import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { endpoints, tagKeys, useApiClient } from "@librephotos/api-client";

/**
 * A photo's tags (the user's own labels, `/tags/?photo=`), and adding and
 * removing them. Online-only: the mirror has no tag→photo membership, so there
 * is nothing an offline edit could be applied to (doc 07, capability #50).
 */
export function usePhotoTags(photoId: string | null, enabled: boolean) {
  const client = useApiClient();
  return useQuery({
    queryKey: tagKeys.photo(photoId ?? ""),
    queryFn: () => {
      if (!photoId) throw new Error("no photo");
      return endpoints.fetchPhotoTags(client, photoId);
    },
    enabled: enabled && !!photoId,
  });
}

/** Every tag of the user, for suggestions while typing; fetched only while the editor is open. */
export function useAllTags(enabled: boolean) {
  const client = useApiClient();
  const query = useQuery({
    queryKey: tagKeys.list(),
    queryFn: () => endpoints.fetchTagAlbumsList(client),
    enabled,
  });
  return query.data ?? [];
}

export function useTagEdits(photoId: string | null) {
  const client = useApiClient();
  const queryClient = useQueryClient();

  const refresh = useCallback(() => queryClient.invalidateQueries({ queryKey: tagKeys.all }), [queryClient]);

  /** Tag the photo with `name`, creating the tag when the user has none by that name. */
  const addTag = useCallback(
    async (name: string, known: { id: number; name: string }[]) => {
      if (!photoId) return;
      // Creating a tag that exists answers that tag, so the list is a shortcut
      // past a request, not the check.
      const tag = known.find((k) => k.name === name) ?? (await endpoints.createTag(client, name));
      await endpoints.addPhotosToTag(client, tag.id, [photoId]);
      await refresh();
    },
    [client, photoId, refresh]
  );

  const removeTag = useCallback(
    async (tagId: number) => {
      if (!photoId) return;
      await endpoints.removePhotosFromTag(client, tagId, [photoId]);
      await refresh();
    },
    [client, photoId, refresh]
  );

  return { addTag, removeTag };
}
