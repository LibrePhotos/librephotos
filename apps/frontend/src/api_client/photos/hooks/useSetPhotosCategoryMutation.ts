import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { notification } from "../../../service/notifications";
import { parseWithNotification } from "../../../util/zodUtils";
import { DateAlbumQueryKeys } from "../../albums/hooks/useFetchDateAlbumQuery";
import { DateAlbumsQueryKeys } from "../../albums/hooks/useFetchDateAlbumsQuery";
import { fetchClient, queryClient } from "../../api";
import { CountStatsQueryKeys } from "../../stats/hooks/useFetchCountStatsQuery";
import { BulkPhotoQuery } from "../types";
import { PhotoDetailsQueryKeys } from "./useFetchPhotoDetailsQuery";

export type PhotoCategory = "photo" | "screenshot" | "document";

const SetPhotosCategoryResponse = z.object({
  status: z.boolean(),
  updated_hashes: z.string().array().optional(),
  not_updated_hashes: z.string().array().optional(),
  count: z.number().optional(),
});

type CategoryFields = {
  category: PhotoCategory;
  // "auto" puts back a detected category (the lightbox's Undo); the server
  // pins every other change as "user", which rescans leave alone.
  category_source?: "user" | "auto";
  // Show the default "N items marked as ..." toast; the lightbox shows its
  // own, with an Undo button.
  notify?: boolean;
};

type IndividualRequest = CategoryFields & {
  select_all?: false;
  image_hashes: string[];
};

type SelectAllRequest = CategoryFields & {
  select_all: true;
  query: BulkPhotoQuery;
  excluded_hashes?: string[];
};

export type SetPhotosCategoryRequest = IndividualRequest | SelectAllRequest;

// The photo category from its two flags. A photo the detector flagged as
// both shows as a screenshot, the category the timeline filter names first.
export function photoCategory(photo: { is_screenshot?: boolean; is_document?: boolean }): PhotoCategory {
  if (photo.is_screenshot) return "screenshot";
  if (photo.is_document) return "document";
  return "photo";
}

// Mark photos as photo / screenshot / document
export const useSetPhotosCategoryMutation = () =>
  useMutation({
    mutationFn: async ({ notify = true, ...request }: SetPhotosCategoryRequest) => {
      const response = await fetchClient.post("/photosedit/category/", request);
      const data = parseWithNotification(
        SetPhotosCategoryResponse,
        response,
        "Failed to parse set photos category response"
      );
      if (notify) {
        notification.setPhotosCategory(data.count ?? 0, request.category);
      }
      return data;
    },
    onSuccess: () => {
      // A changed category moves photos in or out of a filtered timeline and
      // the Screenshots page, and changes the stats tiles. Photo details are
      // keyed by hash or id depending on the caller, so all of them (only the
      // lightbox's few are loaded) refetch.
      queryClient.invalidateQueries({ queryKey: [...DateAlbumsQueryKeys] });
      queryClient.invalidateQueries({ queryKey: [...DateAlbumQueryKeys] });
      queryClient.invalidateQueries({ queryKey: [...CountStatsQueryKeys] });
      queryClient.invalidateQueries({ queryKey: [...PhotoDetailsQueryKeys] });
    },
  });
