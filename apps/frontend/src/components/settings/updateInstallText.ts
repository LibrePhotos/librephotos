import type { ParseKeys } from "i18next";

/**
 * Why a download of the Windows app's updater failed (#2788), by the server's error code; codes a
 * later server adds fall back to `updates.install.failure.unknown`.
 */
const FAILURES: Partial<Record<string, ParseKeys>> = {
  checksum_mismatch: "updates.install.failure.checksum_mismatch",
  missing_sha256sums: "updates.install.failure.no_checksums",
  no_checksum: "updates.install.failure.no_checksums",
  bad_signature: "updates.install.failure.bad_signature",
  disk_full: "updates.install.failure.disk_full",
  disk_error: "updates.install.failure.disk_error",
  folder_in_the_way: "updates.install.failure.folder_in_the_way",
  timeout: "updates.install.failure.network",
  unreachable: "updates.install.failure.network",
  interrupted: "updates.install.failure.network",
  restart_failed: "updates.install.failure.restart_failed",
  bad_zip: "updates.install.failure.bad_zip",
};

export function installFailureKey(code: string | null): ParseKeys {
  return FAILURES[code ?? ""] ?? "updates.install.failure.unknown";
}

/** Why the Windows app cannot update itself; null for an install the docs' steps are for anyway. */
const UNSUPPORTED: Partial<Record<string, ParseKeys>> = {
  read_only: "updates.install.unsupported.read_only",
  data_in_program_folder: "updates.install.unsupported.data_in_program_folder",
  library_in_program_folder: "updates.install.unsupported.library_in_program_folder",
};

export function unsupportedReasonKey(reason: string | null): ParseKeys | null {
  return UNSUPPORTED[reason ?? ""] ?? null;
}
