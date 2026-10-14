import { endpoints, photoKeys } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";
import { selectionArgs, type PhotoSelection } from "../photoSelection";

/** How many of the selected photos have a location, and when they were taken (#2279). */
export const useLocationSummaryQuery = (selection: PhotoSelection | null) =>
  useQuery({
    queryKey: photoKeys.locationSummary(selection ?? {}),
    queryFn: () => {
      const [imageHashes, selectAll] = selectionArgs(selection ?? { image_hashes: [] });
      return endpoints.fetchLocationSummary(apiClient, imageHashes, selectAll);
    },
    enabled: selection !== null,
    // Read when the dialog opens; a location saved meanwhile is the dialog's own.
    staleTime: 0,
  });
