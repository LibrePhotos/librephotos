import { endpoints, photoGridKeys } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { groupEntries } from "../../../util/helpers";
import { apiClient } from "../../api";

export const useFetchSharedPhotosByMeQuery = () =>
  useQuery({
    queryKey: photoGridKeys.sharedByMe(),
    queryFn: async () => {
      const results = await endpoints.fetchSharedPhotosByMe(apiClient);
      const grouped = groupEntries(results, share => share.user_id).map(el => ({
        userId: parseInt(el[0], 10),
        photos: el[1].map(item => item.photo),
      }));
      return grouped;
    },
  });
