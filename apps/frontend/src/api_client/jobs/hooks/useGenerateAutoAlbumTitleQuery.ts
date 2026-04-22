import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { parseWithNotification } from "../../../util/zodUtils";
import { fetchClient } from "../../api";

export const GenerateAutoAlbumTitleQueryKeys = ["generateAutoAlbumTitle"] as const;

export type GenerateEventAlbumsTitlesResponse = z.infer<typeof GenerateEventAlbumsTitlesResponse>;
export const GenerateEventAlbumsTitlesResponse = z.object({
  status: z.boolean(),
  // To-Do: Why is it not a number?!?!
  job_id: z.string().optional(),
});

export const useGenerateAutoAlbumTitleQuery = (title: string) =>
  useQuery({
    queryKey: [...GenerateAutoAlbumTitleQueryKeys, title],
    queryFn: async () => {
      const response = await fetchClient.get(`/generateeventalbums/titles/?title=${title}`);
      return parseWithNotification(
        GenerateEventAlbumsTitlesResponse,
        response,
        "Failed to parse generate auto album title response"
      );
    },
    enabled: !!title,
  });
