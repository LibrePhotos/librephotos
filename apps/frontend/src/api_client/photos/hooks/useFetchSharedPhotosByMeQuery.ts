import { endpoints, photoGridKeys } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { groupBy, toPairs } from "lodash-es";
import { apiClient } from "../../api";

export const useFetchSharedPhotosByMeQuery = () =>
  useQuery({
    queryKey: photoGridKeys.sharedByMe(),
    queryFn: async () => {
      const results = await endpoints.fetchSharedPhotosByMe(apiClient);
      const grouped = toPairs(groupBy(results, "user_id")).map(el => ({
        userId: parseInt(el[0], 10),
        photos: el[1].map(item => item.photo),
      }));
      return grouped;
    },
  });
