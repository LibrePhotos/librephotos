import { fetchAllPages } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { groupBy, toPairs } from "lodash-es";
import { z } from "zod";
import { parseWithNotification } from "../../../util/zodUtils";
import { fetchClient } from "../../api";
import { photoGridKeys } from "../keys";
import { PigPhoto } from "../types";

const SharedPhotosWithMeResponse = z.object({
  results: PigPhoto.array(),
});

export const useFetchSharedPhotosWithMeQuery = () =>
  useQuery({
    queryKey: photoGridKeys.sharedWithMe(),
    queryFn: async () => {
      const rows = await fetchAllPages(fetchClient, "/photos/shared/tome/");
      const { results } = parseWithNotification(
        SharedPhotosWithMeResponse,
        { results: rows },
        "Failed to parse shared photos with me"
      );
      return toPairs(groupBy(results, "owner.id")).map(el => ({ userId: parseInt(el[0], 10), photos: el[1] }));
    },
  });
