import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { parseWithNotification } from "../../../util/zodUtils";
import { fetchClient } from "../../api";

export const SocialGraphQueryKeys = ["socialGraph"] as const;

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

export const useFetchSocialGraphQuery = () =>
  useQuery({
    queryKey: [...SocialGraphQueryKeys],
    queryFn: async () => {
      const response = await fetchClient.get("/socialgraph/");
      return parseWithNotification(PersonDataPointList, response, "Failed to parse social graph");
    },
  });
