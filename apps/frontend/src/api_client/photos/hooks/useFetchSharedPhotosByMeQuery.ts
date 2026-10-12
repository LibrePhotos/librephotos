import { fetchAllPages } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { groupBy, toPairs } from "lodash-es";
import { z } from "zod";
import { parseWithNotification } from "../../../util/zodUtils";
import { apiClient } from "../../api";
import { photoGridKeys } from "../keys";
import { PigPhoto, SimpleUser } from "../types";

const SharedPhotosByMeResponse = z.object({
  results: z
    .object({
      user_id: z.number(),
      user: SimpleUser,
      photo: PigPhoto,
    })
    .array(),
});

export const useFetchSharedPhotosByMeQuery = () =>
  useQuery({
    queryKey: photoGridKeys.sharedByMe(),
    queryFn: async () => {
      const rows = await fetchAllPages(apiClient, "/photos/shared/fromme/");
      const { results } = parseWithNotification(
        SharedPhotosByMeResponse,
        { results: rows },
        "Failed to parse shared photos by me"
      );
      const grouped = toPairs(groupBy(results, "user_id")).map(el => ({
        userId: parseInt(el[0], 10),
        photos: el[1].map(item => item.photo),
      }));
      return grouped;
    },
  });
