import _ from "lodash";
import { useQuery } from '@tanstack/react-query';
import { z } from "zod";

import { PigPhoto, SimpleUser } from "../types";
import { fetchClient } from "../../api";

export const SharedPhotosByMeQueryKeys = ["sharedPhotosByMe"] as const;

const SharedPhotosByMeResponse = z.object({
  results: z
    .object({
      user_id: z.number(),
      user: SimpleUser,
      photo: PigPhoto,
    })
    .array(),
});

export const useFetchSharedPhotosByMeQuery = () => useQuery({
  queryKey: [...SharedPhotosByMeQueryKeys],
  queryFn: async () => {
    const response = await fetchClient.get('/photos/shared/fromme/');
    const { results } = SharedPhotosByMeResponse.parse(response);
    const grouped = _.toPairs(_.groupBy(results, "user_id")).map(el => ({
      userId: parseInt(el[0], 10),
      photos: el[1].map(item => item.photo),
    }));
    return grouped;
  },
}); 