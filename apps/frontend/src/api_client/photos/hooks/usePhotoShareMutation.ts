import { useMutation, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { parseWithNotification } from "../../../util/zodUtils";
import { fetchClient, queryClient } from "../../api";

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

/** Create, rotate or revoke the public link for one photo (issue #2028). */
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
