/**
 * Detect faces again on one photo, followed to its end (#1117): the photo's People section says
 * what the scan found instead of only "started". One report per photo (`Photo.id`), kept in memory
 * until it is dismissed or the page reloads.
 */
type DetectFacesReport = Readonly<{
  jobId: string;
  /** The photo's faces when the People section first saw the scan running; null until then. */
  before: readonly number[] | null;
  state: "running" | "done" | "failed";
}>;

const reports = new Map<string, DetectFacesReport>();
const listeners = new Set<() => void>();

function update(photoId: string, report: DetectFacesReport | undefined): void {
  if (report) reports.set(photoId, report);
  else reports.delete(photoId);
  listeners.forEach(listener => listener());
}

export const detectFacesReports = {
  /** A scan of the photo `photoId` started as the job `jobId`. */
  start(photoId: string, jobId: string): void {
    update(photoId, { jobId, before: null, state: "running" });
  },
  /** The faces the photo had before the scan, to tell the new ones apart. */
  remember(photoId: string, faceIds: readonly number[]): void {
    const report = reports.get(photoId);
    if (report?.before === null) update(photoId, { ...report, before: faceIds });
  },
  /** The job `jobId` ended, and the photo's faces were fetched again. */
  finish(photoId: string, jobId: string, failed: boolean): void {
    const report = reports.get(photoId);
    if (report?.jobId === jobId) update(photoId, { ...report, state: failed ? "failed" : "done" });
  },
  dismiss(photoId: string): void {
    update(photoId, undefined);
  },
  get(photoId: string): DetectFacesReport | undefined {
    return reports.get(photoId);
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
