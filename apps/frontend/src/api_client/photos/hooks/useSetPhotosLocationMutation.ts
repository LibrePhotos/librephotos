import { endpoints, photoKeys } from "@librephotos/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import i18n from "../../../i18n";
import { notification } from "../../../service/notifications";
import { invalidatePlaces } from "../../albums/invalidatePlaces";
import { apiClient } from "../../api";
import { selectionArgs, type PhotoSelection } from "../photoSelection";

export type SetPhotosLocationRequest = Readonly<{
  selection: PhotoSelection;
  lat: number;
  lon: number;
  /** Also move the photos that have a location; false leaves them where they are. */
  overwrite: boolean;
}>;

/** Give the selected photos one location (#2279); the server looks the place up once. */
export const useSetPhotosLocationMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ selection, lat, lon, overwrite }: SetPhotosLocationRequest) => {
      const [imageHashes, selectAll] = selectionArgs(selection);
      const result = await endpoints.setPhotosLocation(apiClient, imageHashes, { lat, lon, overwrite }, selectAll);
      notification.photosLocationSet(result);
      return result;
    },
    onSuccess: () => {
      // The photos move between Places albums, onto the map and out of "Without Location"; the
      // lightbox of a moved photo shows its new place.
      invalidatePlaces();
      return queryClient.invalidateQueries({ queryKey: photoKeys.details() });
    },
    // At hook level, so it also reports a save whose dialog closed meanwhile.
    onError: () => {
      notification.requestFailed(i18n.t("toasts.setlocationtitle"), i18n.t("toasts.setlocationfailed"));
    },
  });
};
