import { useQuery } from "@tanstack/react-query";
import _ from "lodash";
import { z } from "zod";

import { fetchClient } from "../../api";
import { PigPhoto } from "../types";

const SharedPhotosWithMeResponse = z.object({
  results: PigPhoto.array(),
});

export const SharedPhotosWithMeQueryKeys = ["sharedPhotosWithMe"] as const;

export const useFetchSharedPhotosWithMeQuery = () =>
  useQuery({
    queryKey: [...SharedPhotosWithMeQueryKeys],
    queryFn: async () => {
      const response = await fetchClient.get("/photos/shared/tome/");
      const { results } = SharedPhotosWithMeResponse.parse(response);
      return _.toPairs(_.groupBy(results, "owner.id")).map(el => ({ userId: parseInt(el[0], 10), photos: el[1] }));
    },
  });
