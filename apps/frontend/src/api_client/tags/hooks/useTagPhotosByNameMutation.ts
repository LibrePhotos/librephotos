import { useMutation } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { parseWithNotification } from "../../../util/zodUtils";
import { fetchClient, queryClient } from "../../api";
import { Tag, TagList, TagPhotosByNameParams } from "../types";
import { TagAlbumQueryKeys } from "./useFetchTagAlbumQuery";
import { TagsQueryKeys } from "./useFetchTagsQuery";

/** Resolve a typed name to its tag, creating the tag when it is new.
 *
 * POST /tags/ answers with the existing tag when the account already owns the
 * name, so this needs no separate existence check -- which matters because the
 * cached tag list is only the first page.
 */
async function resolveTag(name: string, cached: TagList | undefined) {
  const known = cached?.find(tag => tag.name === name);
  if (known) {
    return { tag: known, created: false };
  }
  const response = await fetchClient.post(`/tags/`, { name });
  return { tag: parseWithNotification(Tag, response, "Failed to parse tag"), created: true };
}

/**
 * Attach several tags, given by name, to a whole selection in one go.
 *
 * Deliberately not built out of `useCreateTagMutation` +
 * `useAddPhotosToTagMutation`: those each raise their own toast, so tagging a
 * selection with three new tags would stack up six of them. Here the whole
 * edit reports once, and either all of it lands or the caller hears about it.
 */
export const useTagPhotosByNameMutation = () =>
  useMutation({
    mutationFn: async ({ names, photos, selectAll, photoCount }: TagPhotosByNameParams) => {
      const cached = queryClient.getQueryData<TagList>([...TagsQueryKeys]);
      const payload = selectAll ?? { photos: photos ?? [] };

      const applied: string[] = [];
      // Sequential on purpose: two names that are both new and both normalise
      // to the same tag would otherwise race on the unique (name, owner)
      // constraint, and a library-wide add is heavy enough server-side that
      // firing them in parallel only moves the queue.
      for (const name of names) {
        // eslint-disable-next-line no-await-in-loop
        const { tag } = await resolveTag(name, cached);
        // eslint-disable-next-line no-await-in-loop
        await fetchClient.post(`/tags/${tag.id}/add/`, payload);
        applied.push(tag.name);
      }

      notification.taggedPhotos(applied, photoCount);
      return applied;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...TagsQueryKeys] });
      queryClient.invalidateQueries({ queryKey: [...TagAlbumQueryKeys] });
    },
  });
