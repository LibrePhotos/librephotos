import { z } from "zod";

export const UploadResponse = z.object({
  data: z.object({
    upload_id: z.string(),
    offset: z.string(),
  }),
});
