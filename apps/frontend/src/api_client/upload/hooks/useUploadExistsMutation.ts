import { z } from "zod";

export const UploadExistResponse = z.object({
  exists: z.boolean(),
});
