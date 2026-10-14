import { endpoints, searchKeys } from "@librephotos/api-client";
import type { MetadataValueField } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";

/**
 * The suggestions of a search filter: the cameras, makers or lenses of my photos with how many
 * photos each one took, most first. Library-wide, not the current results. `enabled` waits for
 * the filter panel to open.
 */
export const useMetadataValuesQuery = (field: MetadataValueField, enabled = true) =>
  useQuery({
    queryKey: searchKeys.metadataValues(field),
    queryFn: () => endpoints.fetchMetadataValues(apiClient, field),
    enabled,
  });
