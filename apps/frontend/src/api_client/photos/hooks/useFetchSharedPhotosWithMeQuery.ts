import { endpoints, photoGridKeys } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { groupEntries } from "../../../util/helpers";
import { apiClient } from "../../api";

export const useFetchSharedPhotosWithMeQuery = () =>
  useQuery({
    queryKey: photoGridKeys.sharedWithMe(),
    queryFn: async () => {
      const results = await endpoints.fetchSharedPhotosWithMe(apiClient);
      return groupEntries(results, photo => photo.owner?.id).map(el => ({
        userId: parseInt(el[0], 10),
        photos: el[1],
      }));
    },
  });
