import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { parseWithNotification } from "../../../util/zodUtils";
import { fetchClient } from "../../api";
import { UploadOptions } from "../types";

export const UploadResponse = z.object({
  upload_id: z.string(),
  offset: z.number(),
});

const upload = (options: UploadOptions) => {
  const headers = new Headers({
    "Content-Range": `bytes ${options.offset}-${options.offset + options.chunk_size - 1}/${options.chunk_size}`,
  });
  return fetchClient
    .request("/upload/", {
      method: "POST",
      body: options.form_data,
      headers,
    })
    .then(response => parseWithNotification(UploadResponse, response, "Failed to parse upload response"));
};

export const useUploadMutation = () =>
  useMutation({
    mutationFn: upload,
    // Don't invalidate queries on every chunk upload
    // Invalidation will happen when the entire file upload is complete
  });
