import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import i18n from "../../../i18n";
import { notification } from "../../../service/notifications";
import { parseWithNotification } from "../../../util/zodUtils";
import { apiClient, queryClient } from "../../api";
import { statsKeys } from "../../stats/keys";
import { photoGridKeys, photoKeys } from "../keys";
import type { BulkPhotoQuery } from "../types";

export type PhotoCategory = "photo" | "screenshot" | "document";

const SetPhotosCategoryResponse = z.object({
  status: z.boolean(),
  updated_hashes: z.string().array().optional(),
  not_updated_hashes: z.string().array().optional(),
  count: z.number().optional(),
});

type CategoryFields = {
  // A category is pinned as set by the user, which rescans leave alone.
  // "auto" hands the photos back to the detectors, which recompute both
  // flags (the lightbox's Undo of a first correction).
  category: PhotoCategory | "auto";
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
      const response = await apiClient.post("/photosedit/category/", request);
      const data = parseWithNotification(
        SetPhotosCategoryResponse,
        response,
        "Failed to parse set photos category response"
      );
      if (notify && request.category !== "auto") {
        notification.setPhotosCategory(data.count ?? 0, request.category);
      }
      return data;
    },
    onSuccess: () => {
      // A changed category moves photos in or out of a filtered timeline and
      // the Screenshots page, and changes the stats tiles. Photo details are
      // keyed by hash or id depending on the caller, so all of them (only the
      // lightbox's few are loaded) refetch.
      queryClient.invalidateQueries({ queryKey: photoGridKeys.kind("dateAlbums") });
      queryClient.invalidateQueries({ queryKey: photoGridKeys.kind("dateAlbum") });
      queryClient.invalidateQueries({ queryKey: statsKeys.counts() });
      queryClient.invalidateQueries({ queryKey: photoKeys.details() });
    },
    // At hook level, so it also reports an Undo fired after the lightbox
    // closed (per-call callbacks of an unmounted component never run).
    onError: () => {
      notification.requestFailed(i18n.t("toasts.setcategorytitle"), i18n.t("toasts.setcategoryfailed"));
    },
  });
