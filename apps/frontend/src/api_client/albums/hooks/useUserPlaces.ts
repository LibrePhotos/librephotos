import {
  albumKeys,
  endpoints,
  photoGridKeys,
  type UserPlaceCircle,
  type UserPlaceFields,
} from "@librephotos/api-client";
import type { MediaType } from "@librephotos/api-client";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { mediaTypeToBulkQuery } from "../../../components/photolist/mediaTypeFilter";
import { notification } from "../../../service/notifications";
import { apiClient } from "../../api";
import { mutationErrorMeta, type MutationErrorOptions } from "../../mutationErrors";

/** My places (#1365), by name, each with its photo count. */
export const useUserPlacesQuery = () =>
  useQuery({
    queryKey: albumKeys.userPlaces(),
    queryFn: () => endpoints.fetchUserPlaces(apiClient),
  });

const NO_CIRCLE: UserPlaceCircle = { lat: 0, lon: 0, radiusM: 0 };

/**
 * What the circle being drawn holds; off until it has a centre. The last answer stays while the
 * next loads, so the count does not blink while the radius is dragged.
 */
export const useUserPlacePreviewQuery = (circle: UserPlaceCircle | null) =>
  useQuery({
    queryKey: albumKeys.userPlacePreview(circle ?? NO_CIRCLE),
    queryFn: () => endpoints.fetchUserPlacePreview(apiClient, circle ?? NO_CIRCLE),
    enabled: circle !== null,
    placeholderData: keepPreviousData,
  });

/** A place's photos by day, for its page. */
export const useUserPlacePhotosQuery = (placeId: number, mediaType?: MediaType) =>
  useQuery({
    queryKey: photoGridKeys.userPlace(placeId, mediaType ?? "all"),
    queryFn: () => endpoints.fetchUserPlacePhotos(apiClient, placeId, mediaTypeToBulkQuery(mediaType)),
  });

/** A new place (no `id`), or the changes to one. */
export type SaveUserPlaceParams = Readonly<{ id?: number; fields: UserPlaceFields }>;

/** My places and every grid that shows their photos. */
function refreshUserPlaces(queryClient: ReturnType<typeof useQueryClient>) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: albumKeys.userPlaces() }),
    queryClient.invalidateQueries({ queryKey: photoGridKeys.kind("userPlace") }),
  ]);
}

/** Draw a place or change one; my photos are filed into it at once, and the toast says how many. */
export const useSaveUserPlaceMutation = (options: MutationErrorOptions = {}) => {
  const queryClient = useQueryClient();
  return useMutation({
    meta: mutationErrorMeta(options),
    mutationFn: ({ id, fields }: SaveUserPlaceParams) =>
      id === undefined
        ? endpoints.createUserPlace(apiClient, fields)
        : endpoints.updateUserPlace(apiClient, id, fields),
    onSuccess: place => {
      notification.saveUserPlace(place.name, place.photo_count);
      return refreshUserPlaces(queryClient);
    },
  });
};

type DeleteUserPlaceParams = Readonly<{ id: number; name: string }>;

/** Delete a place; its photos stay in the library. */
export const useDeleteUserPlaceMutation = (options: MutationErrorOptions = {}) => {
  const queryClient = useQueryClient();
  return useMutation({
    meta: mutationErrorMeta(options),
    mutationFn: ({ id }: DeleteUserPlaceParams) => endpoints.deleteUserPlace(apiClient, id),
    onSuccess: (_, { name }) => {
      notification.deleteUserPlace(name);
      return refreshUserPlaces(queryClient);
    },
  });
};
