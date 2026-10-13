import { endpoints, photoGridKeys } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";

// Fetch recently added photos
export const useFetchRecentlyAddedPhotosQuery = () =>
  useQuery({
    queryKey: photoGridKeys.recentlyAdded(),
    queryFn: () => endpoints.fetchRecentlyAddedPhotos(apiClient),
  });
