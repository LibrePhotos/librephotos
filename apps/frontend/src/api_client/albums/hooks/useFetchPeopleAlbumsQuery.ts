import { useQuery } from "@tanstack/react-query";
import _ from "lodash";
import { z } from "zod";
import { parseWithNotification } from "../../../util/zodUtils";
import { fetchClient } from "../../api";

export const PeopleAlbumsQueryKeys = ["peopleAlbums"] as const;

export const PersonResponse = z.object({
  name: z.string(),
  face_url: z.string().nullable(),
  face_count: z.number(),
  face_photo_url: z.string(),
  video: z.boolean().optional(),
  id: z.number(),
  newPersonName: z.string().optional(),
  cover_photo: z.string().optional(),
});

export const Person = z.object({
  id: z.string(),
  name: z.string(),
  video: z.boolean(),
  face_count: z.number(),
  face_photo_url: z.string(),
  face_url: z.string(),
});

export const People = Person.array();

export type Person = z.infer<typeof Person>;
export type People = z.infer<typeof People>;

export const PeopleResponse = z.object({
  count: z.number(),
  next: z.string().nullable(),
  previous: z.string().nullable(),
  results: PersonResponse.array(),
});

export const useFetchPeopleAlbumsQuery = (skip: boolean = false) =>
  useQuery({
    queryKey: [...PeopleAlbumsQueryKeys],
    queryFn: async () => {
      const response = await fetchClient.get("/persons/?page_size=1000");

      const people = parseWithNotification(PeopleResponse, response, "Failed to parse people albums").results.map(
        item => ({
          id: item.id.toString(),
          name: item.name ?? "",
          video: !!item.video,
          face_count: item.face_count,
          face_photo_url: item.face_photo_url ?? "",
          face_url: item.face_url ?? "",
        })
      );

      return _.orderBy(people, ["name", "face_count"], ["asc", "desc"]);
    },
    enabled: !skip,
  });
