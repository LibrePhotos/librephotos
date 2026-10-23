import { endpoints, jobKeys, pollWhile, type UploadStatus, type UploadStatusParams } from "@librephotos/api-client";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";

/**
 * The signed-in user's upload imports and follow-ups (#2739), with the jobs and photos in `params`.
 * Polls every two seconds while `isActive` holds, otherwise only often enough to notice uploads
 * from another device. The previous answer stays while the ids change.
 */
export const useUploadStatusQuery = (params: UploadStatusParams, isActive: (status: UploadStatus) => boolean) =>
  useQuery({
    queryKey: jobKeys.uploadStatus(params),
    queryFn: () => endpoints.fetchUploadStatus(apiClient, params),
    refetchInterval: pollWhile(isActive),
    placeholderData: keepPreviousData,
  });
