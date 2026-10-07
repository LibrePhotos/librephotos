// Buttons that start ingest jobs (port of lp-api jobs_zip_services/triggers.rs
// for the scan kinds; api/views/scan_triggers.py): each enqueues a job and
// answers {status, job_id} with the LongRunningJob id the UI polls.
import { existsSync } from "node:fs";
import { json } from "../../lib/http";
import { enqueue, JobType } from "../../lib/jobs";
import type { User } from "../../lib/users";

const refuse = (message: string) => json({ status: false, message }, 400);

/** _validate_scan_directory. */
function validateScanDirectory(user: User): Response | null {
  const dir = user.scanDirectory;
  if (!dir.trim()) {
    return refuse("Scan failed: No scan directory configured. Please contact your administrator to set up a scan directory for your account.");
  }
  if (!existsSync(dir)) return refuse(`Scan failed: Scan directory '${dir}' does not exist. Please contact your administrator.`);
  return null;
}

/** start_job: 200 {status: true, job_id}, or 500 when enqueueing failed. */
async function startJob(kind: string, payload: unknown, jobType: JobType, userId: number, description: string) {
  try {
    const { lrjId } = await enqueue(kind, payload, { lrj: { jobType, userId } });
    return { status: true, job_id: lrjId };
  } catch (e) {
    console.error(`could not start ${description}: ${e}`);
    return json({ status: false, message: `Could not start ${description}.` }, 500);
  }
}

export async function scanPhotos(user: User, fullScan: boolean) {
  const refused = validateScanDirectory(user);
  if (refused) return refused;
  return startJob("scan.user", { user_id: user.id, full_scan: fullScan, scan_missing: false, uploaded_only: false }, JobType.ScanPhotos, user.id, "the photo scan");
}

export const deleteMissingPhotos = (user: User) =>
  startJob("delete.missing_photos", { user_id: user.id }, JobType.DeleteMissingPhotos, user.id, "the missing-photo cleanup");
