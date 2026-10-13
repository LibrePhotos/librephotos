import { endpoints, photoKeys, type PhotoShareAction } from "@librephotos/api-client";
import { useMutation, useQuery } from "@tanstack/react-query";
import i18n from "../../../i18n";
import { notification } from "../../../service/notifications";
import { apiClient, ApiError, queryClient } from "../../api";

/** Create, rotate or revoke the public link for one photo (issue #2028).
 *
 * Failures are reported here, once, so callers can use `mutate` without
 * handling the rejection themselves.
 */
export const usePhotoShareMutation = () =>
  useMutation({
    mutationFn: (request: { photoId: string; action: PhotoShareAction }) =>
      endpoints.setPhotoShareLink(apiClient, request.photoId, request.action),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: photoKeys.shares() });
    },
    onError: () => {
      notification.error(i18n.t("sharing.photoLinkFailed"), { title: i18n.t("sharing.photoLink") });
    },
  });

/** The current user's active photo share links, newest first. */
export const useFetchPhotoSharesQuery = (enabled = true) =>
  useQuery({
    queryKey: photoKeys.shares(),
    enabled,
    queryFn: () => endpoints.fetchPhotoShareLinks(apiClient),
  });

/** A photo shared by link, or `null` when the link is unknown or revoked. */
export const useFetchSharedPhotoQuery = (slug: string) =>
  useQuery({
    queryKey: photoKeys.sharedBySlug(slug),
    retry: false,
    queryFn: async () => {
      // Through the client, like the public album page: a visitor has no session
      // (a 401 on a public page logs nobody out), and a 404 is an answer
      // (unknown or revoked link), not an error.
      try {
        return await endpoints.fetchSharedPhoto(apiClient, slug);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
  });
