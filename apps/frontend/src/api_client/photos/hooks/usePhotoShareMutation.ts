import { showNotification } from "@mantine/notifications";
import { useMutation, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import i18n from "../../../i18n";
import { parseWithNotification } from "../../../util/zodUtils";
import { fetchClient, queryClient } from "../../api";
import { serverAddress } from "../../apiClient";

export const PhotoShare = z.object({
  enabled: z.boolean(),
  slug: z.string().nullable(),
  url: z.string().nullable(),
  created_at: z.string().optional(),
  photo_id: z.string().optional(),
  image_hash: z.string().optional(),
});
export type PhotoShare = z.infer<typeof PhotoShare>;

const PhotoShareResponse = z.object({ status: z.boolean(), share: PhotoShare });
const PhotoShareListResponse = z.object({ results: PhotoShare.array() });

export const PhotoSharesQueryKeys = ["photoShares"];

export type PhotoShareAction = "enable" | "rotate" | "disable";

/** Create, rotate or revoke the public link for one photo (issue #2028).
 *
 * Failures are reported here, once, so callers can use `mutate` without
 * handling the rejection themselves.
 */
export const usePhotoShareMutation = () =>
  useMutation({
    mutationFn: async (request: { photoId: string; action: PhotoShareAction }) => {
      const response = await fetchClient.post("/photo/share", {
        photo_id: request.photoId,
        action: request.action,
      });
      return parseWithNotification(PhotoShareResponse, response, "Failed to parse photo share response").share;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...PhotoSharesQueryKeys] });
    },
    onError: () => {
      showNotification({
        title: i18n.t("sharing.photoLink"),
        message: i18n.t("sharing.photoLinkFailed"),
        color: "red",
      });
    },
  });

/** The current user's active photo share links, newest first. */
export const useFetchPhotoSharesQuery = (enabled = true) =>
  useQuery({
    queryKey: [...PhotoSharesQueryKeys],
    enabled,
    queryFn: async () => {
      const response = await fetchClient.get("/photo/share/list");
      return parseWithNotification(PhotoShareListResponse, response, "Failed to parse photo shares response").results;
    },
  });

// What an anonymous visitor gets for /public/p/<slug>. Media come as
// slug-scoped URLs, so revoking the link cuts them off too.
export const SharedPhoto = z.object({
  video: z.boolean(),
  thumbnail_url: z.string(),
  video_url: z.string().nullable(),
  exif_timestamp: z.string().nullable().optional(),
  search_location: z.string().optional(),
  camera: z.string().nullable().optional(),
  lens: z.string().nullable().optional(),
  search_captions: z.string().optional(),
  captions_json: z.record(z.unknown()).optional(),
  people: z.array(z.object({ name: z.string() })).optional(),
});
export type SharedPhoto = z.infer<typeof SharedPhoto>;

const SharedPhotoResponse = z.object({ results: SharedPhoto });

/** A photo shared by link, or `null` when the link is unknown or revoked. */
export const useFetchSharedPhotoQuery = (slug: string) =>
  useQuery({
    queryKey: ["sharedPhotoBySlug", slug],
    retry: false,
    queryFn: async () => {
      // Plain fetch, like the public album page: a visitor has no session,
      // and a 404 here is an answer (revoked), not an error.
      const resp = await fetch(`${serverAddress}/api/public/photo/${encodeURIComponent(slug)}/`);
      if (resp.status === 404) return null;
      if (!resp.ok) throw new Error("Failed to load shared photo");
      return parseWithNotification(SharedPhotoResponse, await resp.json(), "Failed to parse shared photo").results;
    },
  });
