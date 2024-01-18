import { z } from "zod";

import { api } from "./api";

export const Node = z.object({
  id: z.string(),
  x: z.number(),
  y: z.number(),
});

export const Link = z.object({
  source: z.string(),
  target: z.string(),
});

export const PersonDataPointListSchema = z.object({
  nodes: Node.array(),
  links: Link.array(),
});

type PersonDataPointList = z.infer<typeof PersonDataPointListSchema>;

enum Endpoints {
  fetchSocialGraph = "fetchSocialGraph",
}

export const peopleApi = api
  .injectEndpoints({
    endpoints: builder => ({
      [Endpoints.fetchSocialGraph]: builder.query<PersonDataPointList, void>({
        query: () => "socialgraph/",
        transformResponse: response => PersonDataPointListSchema.parse(response),
      }),
    }),
  })
  .enhanceEndpoints<"SocialGraph">({
    addTagTypes: ["SocialGraph"],
    endpoints: {
      [Endpoints.fetchSocialGraph]: {
        providesTags: ["SocialGraph"],
      },
    },
  });

export const { useFetchSocialGraphQuery } = peopleApi;
