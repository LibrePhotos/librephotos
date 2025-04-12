import _ from "lodash";
import { useQuery } from '@tanstack/react-query';
import { z } from "zod";

import { fetchClient, QueryKeys } from "../../api";

const PersonResponseSchema = z.object({
  name: z.string(),
  face_url: z.string().nullable(),
  face_count: z.number(),
  face_photo_url: z.string(),
  video: z.boolean().optional(),
  id: z.number(),
  newPersonName: z.string().optional(),
  cover_photo: z.string().optional(),
});

const PersonSchema = z.object({
  id: z.string(),
  name: z.string(),
  video: z.boolean(),
  face_count: z.number(),
  face_photo_url: z.string(),
  face_url: z.string(),
});

const PeopleSchema = PersonSchema.array();

export type Person = z.infer<typeof PersonSchema>;
export type People = z.infer<typeof PeopleSchema>;

const PeopleResponseSchema = z.object({
  count: z.number(),
  next: z.string().nullable(),
  previous: z.string().nullable(),
  results: PersonResponseSchema.array(),
});

export const useFetchPeopleAlbumsQuery = () => useQuery({
  queryKey: [QueryKeys.peopleAlbums],
  queryFn: async () => {
    const response = await fetchClient.get('/persons/?page_size=1000');
    
    const people = PeopleResponseSchema.parse(response).results.map(item => ({
      id: item.id.toString(),
      name: item.name ?? "",
      video: !!item.video,
      face_count: item.face_count,
      face_photo_url: item.face_photo_url ?? "",
      face_url: item.face_url ?? "",
    }));
    
    return _.orderBy(people, ["name", "face_count"], ["asc", "desc"]);
  },
}); 