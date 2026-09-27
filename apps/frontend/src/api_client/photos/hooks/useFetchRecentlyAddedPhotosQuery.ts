import { endpoints } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";

export const RecentlyAddedPhotosQueryKeys = ["recentlyAddedPhotos"] as const;

// Fetch recently added photos
export const useFetchRecentlyAddedPhotosQuery = () =>
  useQuery({
    queryKey: [...RecentlyAddedPhotosQueryKeys],
    queryFn: () => endpoints.fetchRecentlyAddedPhotos(apiClient),
  });
