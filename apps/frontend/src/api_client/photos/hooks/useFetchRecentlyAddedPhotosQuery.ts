import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { parseWithNotification } from "../../../util/zodUtils";
import { fetchClient } from "../../api";
import { PigPhoto } from "../types";

export const RecentlyAddedPhotosQueryKeys = ["recentlyAddedPhotos"] as const;

const RecentlyAddedPhotosResponse = z.object({
  results: PigPhoto.array(),
  date: z.string(),
});
type RecentlyAddedPhotosResponse = z.infer<typeof RecentlyAddedPhotosResponse>;

// Fetch recently added photos
export const useFetchRecentlyAddedPhotosQuery = () =>
  useQuery({
    queryKey: [...RecentlyAddedPhotosQueryKeys],
    queryFn: async () => {
      const response = await fetchClient.get("/photos/recentlyadded/");
      return parseWithNotification(RecentlyAddedPhotosResponse, response, "Failed to parse recently added photos");
    },
  });
