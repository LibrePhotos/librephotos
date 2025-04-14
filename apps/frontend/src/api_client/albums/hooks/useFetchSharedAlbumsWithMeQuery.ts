import _ from "lodash";
import { useQuery } from '@tanstack/react-query';
import { z } from "zod";

import { fetchClient, QueryKeys } from "../../api";
import { UserAlbumListResponse, UserAlbumList } from "../types";

type UserAlbumsGroupedByUserId = {
  user_id: number;
  albums: UserAlbumList[];
};

export const useFetchSharedAlbumsWithMeQuery = () => useQuery({
  queryKey: [QueryKeys.sharedAlbumsWithMe],
  queryFn: async () => {
    const response = await fetchClient.get('/albums/user/shared/tome/');
    const result = UserAlbumListResponse.parse(response).results;
    return _.toPairs(_.groupBy(result, "owner.id")).map(el => ({
      user_id: parseInt(el[0], 10),
      albums: el[1],
    })) as unknown as UserAlbumsGroupedByUserId[];
  },
}); 