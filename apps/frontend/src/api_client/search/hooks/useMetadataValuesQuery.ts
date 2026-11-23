import { endpoints, searchKeys } from "@librephotos/api-client";
import type { MetadataValueField } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";

export const useMetadataValuesQuery = (field: MetadataValueField, enabled = true) =>
  useQuery({
    queryKey: searchKeys.metadataValues(field),
    queryFn: () => endpoints.fetchMetadataValues(apiClient, field),
    enabled,
  });
