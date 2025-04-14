import { useQuery } from "@tanstack/react-query";

import { fetchClient, QueryKeys } from "../../api";
import { z } from "zod";

export const Node = z.object({
    id: z.string(),
    x: z.number(),
    y: z.number(),
  });
  
  export const Link = z.object({
    source: z.string(),
    target: z.string(),
  });
  
  export const PersonDataPointList = z.object({
    nodes: Node.array(),
    links: Link.array(),
  });
  
  export type PersonDataPointList = z.infer<typeof PersonDataPointList>;
  

export const useFetchSocialGraphQuery = () => useQuery({
    queryKey: [QueryKeys.socialGraph],
    queryFn: async () => {
      const response = await fetchClient.get('socialgraph/');
      return PersonDataPointList.parse(response);
    },
  });   