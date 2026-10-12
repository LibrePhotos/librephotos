import { z } from "zod";
import { parseWithNotification } from "../../util/zodUtils";
import { apiClient } from "../api";

const UploadExistResponse = z.object({
  exists: z.boolean(),
});

/** Whether this user already has a file with this MD5 (the server keys uploads by MD5 plus user id). */
export async function uploadExists(md5: string, userId: number): Promise<boolean> {
  const response = await apiClient.get(`/exists/${md5}${userId}`);
  return parseWithNotification(UploadExistResponse, response, "Failed to parse upload exists response").exists;
}
