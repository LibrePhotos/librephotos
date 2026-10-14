import { albumKeys, endpoints } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { orderBy } from "lodash-es";
import { apiClient } from "../../api";

/** A person as the people pages show them: the id as a string, no nulls. */
export type Person = {
  id: string;
  name: string;
  video: boolean;
  face_count: number;
  face_photo_url: string;
  face_url: string;
  /** The ids of the user's groups the person is in (#1126). */
  group_ids: number[];
};

export type PersonList = Person[];

export const useFetchPeopleAlbumsQuery = (skip: boolean = false) =>
  useQuery({
    queryKey: albumKeys.peopleAlbums(),
    queryFn: async () => {
      // 1000 is the server's largest page: the fewest requests for a big library.
      const rows = await endpoints.fetchPeopleAlbums(apiClient, { pageSize: 1000 });

      const people: PersonList = rows.map(item => ({
        id: item.id.toString(),
        name: item.name,
        video: !!item.video,
        face_count: item.face_count,
        face_photo_url: item.face_photo_url ?? "",
        face_url: item.face_url ?? "",
        group_ids: item.group_ids ?? [],
      }));

      return orderBy(people, ["name", "face_count"], ["asc", "desc"]);
    },
    enabled: !skip,
  });
