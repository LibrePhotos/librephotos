import _ from "lodash";
import { useQuery } from '@tanstack/react-query';
import { z } from "zod";

import { PigPhoto } from "../types";
import { fetchClient, QueryKeys } from "../../api";

const SharedPhotosWithMeResponse = z.object({
  results: PigPhoto.array(),
});

export const useFetchSharedPhotosWithMeQuery = () => useQuery({
  queryKey: [QueryKeys.sharedAlbumsWithMe],
  queryFn: async () => {
    const response = await fetchClient.get('photos/shared/tome/');
    const { results } = SharedPhotosWithMeResponse.parse(response);
    return _.toPairs(_.groupBy(results, "owner.id")).map(el => ({ userId: parseInt(el[0], 10), photos: el[1] }));
  },
}); 