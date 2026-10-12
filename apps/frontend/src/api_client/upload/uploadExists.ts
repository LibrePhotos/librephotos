import { endpoints } from "@librephotos/api-client";
import { apiClient } from "../api";
import { notifyParseError } from "../parseErrors";

/**
 * Whether this user already has a file with this MD5 (the server keys uploads by MD5 plus user id).
 * Called outside React Query, so an answer that does not parse is reported here.
 */
export async function uploadExists(md5: string, userId: number): Promise<boolean> {
  try {
    return await endpoints.uploadExists(apiClient, md5, userId);
  } catch (error) {
    notifyParseError(error);
    throw error;
  }
}
