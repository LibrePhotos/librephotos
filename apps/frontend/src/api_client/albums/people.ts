import _ from "lodash";
import { z } from "zod";

import { notification } from "../../service/notifications";
import { api } from "../api";

export const PersonResponseSchema = z.object({
  name: z.string(),
  face_url: z.string().nullable(),
  face_count: z.number(),
  face_photo_url: z.string().nullable(),
  video: z.boolean().optional(),
  id: z.number(),
  newPersonName: z.string().optional(),
  cover_photo: z.string().optional(),
});

export const PeopleSchema = z
  .object({
    key: z.string(),
    value: z.string(),
    text: z.string(),
    video: z.boolean(),
    face_count: z.number(),
    face_photo_url: z.string(),
    face_url: z.string(),
  })
  .array();

type People = z.infer<typeof PeopleSchema>;

const PeopleResponseSchema = z.object({
  count: z.number(),
  next: z.string().nullable(),
  previous: z.string().nullable(),
  results: PersonResponseSchema.array(),
});

enum Endpoints {
  fetchPeopleAlbums = "fetchPeopleAlbums",
  renamePersonAlbum = "renamePersonAlbum",
  deletePersonAlbum = "deletePersonAlbum",
}

export const peopleAlbumsApi = api
  .injectEndpoints({
    endpoints: builder => ({
      [Endpoints.fetchPeopleAlbums]: builder.query<People, void>({
        query: () => "persons/?page_size=1000",
        transformResponse: response => {
          const people = PeopleResponseSchema.parse(response).results.map(item => ({
            key: item.id.toString(),
            value: item.name,
            text: item.name,
            video: !!item.video,
            face_count: item.face_count,
            face_photo_url: item.face_photo_url || "",
            face_url: item.face_url || "",
          }));
          return _.orderBy(people, ["text", "face_count"], ["asc", "desc"]);
        },
      }),
      [Endpoints.renamePersonAlbum]: builder.mutation<void, { id: string; personName: string; newPersonName: string }>({
        query: ({ id, newPersonName }) => ({
          url: `persons/${id}/`,
          method: "PATCH",
          body: { newPersonName },
        }),
        transformResponse(response, meta, query) {
          notification.renamePerson(query.personName, query.newPersonName);
        },
      }),
      [Endpoints.deletePersonAlbum]: builder.mutation<void, string>({
        query: id => ({
          url: `persons/${id}/`,
          method: "DELETE",
        }),
        transformResponse() {
          notification.deletePerson();
        },
      }),
    }),
  })
  .enhanceEndpoints<"PeopleAlbums">({
    addTagTypes: ["PeopleAlbums"],
    endpoints: {
      [Endpoints.fetchPeopleAlbums]: {
        providesTags: ["PeopleAlbums"],
      },
      [Endpoints.renamePersonAlbum]: {
        invalidatesTags: ["PeopleAlbums", "Faces"],
      },
      [Endpoints.deletePersonAlbum]: {
        invalidatesTags: ["PeopleAlbums", "Faces"],
      },
    },
  });

export const { useFetchPeopleAlbumsQuery, useRenamePersonAlbumMutation, useDeletePersonAlbumMutation } =
  peopleAlbumsApi;
