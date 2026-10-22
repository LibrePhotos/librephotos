import { endpoints, userKeys } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";

type Change = Readonly<{
  userId: number;
  scanDirectory: string;
  /** The upload folder with it; "" for the default inside the scan directory. */
  uploadDirectory: string;
  /** Off until the admin picked another existing folder. */
  enabled: boolean;
}>;

/** Admin: how many of a user's photos a scan directory not saved yet leaves outside (#2036). */
export const useScanDirectoryImpactQuery = ({ userId, scanDirectory, uploadDirectory, enabled }: Change) =>
  useQuery({
    queryKey: userKeys.scanDirectoryImpact(userId, scanDirectory, uploadDirectory),
    queryFn: () => endpoints.fetchScanDirectoryImpact(apiClient, userId, scanDirectory, uploadDirectory),
    enabled,
  });
