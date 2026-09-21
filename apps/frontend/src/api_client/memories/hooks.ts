import { useQuery } from "@tanstack/react-query";
import { parseWithNotification } from "../../util/zodUtils";
import { fetchClient } from "../api";
import { FetchMemoriesResponse } from "./types";

export const MemoriesQueryKeys = {
  list: (size?: number) => ["memories", { size }] as const,
};

// The cast restates what zod has already guaranteed at runtime: the schema's
// fields carry defaults, so its parsed output is narrower than its input and
// `parseWithNotification` infers the wider of the two.
const fetchMemories = (size?: number): Promise<FetchMemoriesResponse> =>
  fetchClient
    .get(size ? `/memories?size=${size}` : "/memories")
    .then(
      response =>
        parseWithNotification(FetchMemoriesResponse, response, "Failed to parse memories") as FetchMemoriesResponse
    );

/**
 * The page loads with the default page of items per memory, which is all the
 * tiles need, and asks for the bigger one only once the whole day is on show --
 * as a gallery or as one slideshow. Both sizes stay cached under their own key,
 * so switching back to the tiles costs nothing.
 */
export const useFetchMemoriesQuery = (options?: { size?: number; enabled?: boolean }) =>
  useQuery({
    queryKey: MemoriesQueryKeys.list(options?.size),
    queryFn: () => fetchMemories(options?.size),
    enabled: options?.enabled ?? true,
  });
