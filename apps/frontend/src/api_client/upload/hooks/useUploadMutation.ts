import { endpoints, type UploadOptions } from "@librephotos/api-client";
import { useMutation } from "@tanstack/react-query";
import { apiClient } from "../../api";

const upload = (options: UploadOptions) => endpoints.uploadChunk(apiClient, options);

export const useUploadMutation = () =>
  useMutation({
    mutationFn: upload,
    // Don't invalidate queries on every chunk upload
    // Invalidation will happen when the entire file upload is complete
  });
