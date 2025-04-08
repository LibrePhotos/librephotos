import _ from "lodash";
import { useMutation, useQuery } from '@tanstack/react-query';
import { z } from "zod";

import { notification } from "../../service/notifications";
import { fetchClient, queryClient, QueryKeys } from "../tanstack-api";

export const PersonResponseSchema = z.object({
  name: z.string(),
  face_url: z.string().nullable(),
  face_count: z.number(),
  face_photo_url: z.string(),
  video: z.boolean().optional(),
  id: z.number(),
  newPersonName: z.string().optional(),
  cover_photo: z.string().optional(),
});

export const PersonSchema = z.object({
  id: z.string(),
  name: z.string(),
  video: z.boolean(),
  face_count: z.number(),
  face_photo_url: z.string(),
  face_url: z.string(),
});

export const PeopleSchema = PersonSchema.array();

export type Person = z.infer<typeof PersonSchema>;

export type People = z.infer<typeof PeopleSchema>;

const PeopleResponseSchema = z.object({
  count: z.number(),
  next: z.string().nullable(),
  previous: z.string().nullable(),
  results: PersonResponseSchema.array(),
});

// Fetch people albums
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

// Rename person album mutation
export const useRenamePersonAlbumMutation = () => useMutation({
  mutationFn: async ({ id, personName, newPersonName }: { id: string; personName: string; newPersonName: string }) => {
    await fetchClient.patch(`/persons/${id}/`, { newPersonName });
    notification.renamePerson(personName, newPersonName);
  },
  onSuccess: () => {
    // Invalidate relevant queries
    queryClient.invalidateQueries({ queryKey: [QueryKeys.peopleAlbums] });
    queryClient.invalidateQueries({ queryKey: [QueryKeys.faces] });
  },
});

// Delete person album mutation
export const useDeletePersonAlbumMutation = () => useMutation({
  mutationFn: async (id: string) => {
    await fetchClient.delete(`/persons/${id}/`);
    notification.deletePerson();
  },
  onSuccess: () => {
    // Invalidate relevant queries
    queryClient.invalidateQueries({ queryKey: [QueryKeys.peopleAlbums] });
    queryClient.invalidateQueries({ queryKey: [QueryKeys.faces] });
  },
});

// Set person album cover mutation
export const useSetPersonAlbumCoverMutation = () => useMutation({
  mutationFn: async ({ id, cover_photo }: { id: string; cover_photo: string }) => {
    await fetchClient.patch(`/persons/${id}/`, { cover_photo });
    notification.setCoverPhoto();
  },
}); 