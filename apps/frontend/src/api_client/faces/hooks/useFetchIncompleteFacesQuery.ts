import { faceKeys } from "@librephotos/api-client";
import type { IncompletePersonFaceListRequest } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { fetchIncompletePeople, withPlaceholders } from "../faceListCache";

/** Every person with a placeholder per face; the grid swaps them for real faces page by page. */
export const useFetchIncompleteFacesQuery = (request: IncompletePersonFaceListRequest) =>
  useQuery({
    queryKey: faceKeys.incompleteList(request),
    queryFn: async () => withPlaceholders(await fetchIncompletePeople(request)),
  });
