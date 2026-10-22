import { endpoints } from "@librephotos/api-client";
import { apiClient } from "../api";
import { notifyParseError } from "../parseErrors";

/**
 * The upload run is over: its import jobs take no more files (#2737). Called by the upload queue
 * when it drains. A failure is not reported: the server seals idle jobs a few minutes later anyway.
 */
export async function sealUploadImports(jobIds: string[]): Promise<void> {
  if (jobIds.length === 0) return;
  try {
    await endpoints.sealUploadImports(apiClient, jobIds);
  } catch (error) {
    notifyParseError(error);
  }
}
