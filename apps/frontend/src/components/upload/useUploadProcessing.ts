import type { ImportJob, UploadStatus } from "@librephotos/api-client";
import { useEffect, useMemo, useRef, useState } from "react";
import { invalidateProcessedUploads, invalidateUploadQueries, useUploadStatusQuery } from "../../api_client/upload";
import {
  absorbStatus,
  followedJobIds,
  followedJobs,
  importCounts,
  NO_OUTCOMES,
  pendingUploads,
  processingPhase,
  type ImportCounts,
  type ProcessingPhase,
  type ServerOutcomes,
} from "./uploadProcessing";
import type { UploadItem } from "./useUploadQueue";

/** The timeline is refreshed at most this often while photos become ready. */
const REFRESH_EVERY_MS = 10_000;
/** No progress for this long while the server processes: the card says so. */
const STALL_AFTER_MS = 2 * 60_000;
const MINUTE_MS = 60_000;

export type UploadProcessing = {
  /** Where the card's uploads stand on the server. */
  phase: ProcessingPhase;
  outcomes: ServerOutcomes;
  /** Ready and counted uploads of the card's import jobs (other devices' uploads into them too). */
  counts: ImportCounts;
  /** Whole minutes without progress while processing, or null. */
  stalledMinutes: number | null;
  /** The user's unfinished import jobs from any device: the account menu and the timeline show them. */
  openImports: ImportJob[];
};

const activeWhile =
  (isUploading: boolean, items: UploadItem[], outcomes: ServerOutcomes) =>
  (status: UploadStatus): boolean => {
    const phase = processingPhase(items, outcomes, status);
    return isUploading || phase === "processing" || phase === "followups" || status.imports.some(j => !j.finished);
  };

/**
 * Follows the card's uploads after their bytes are sent (#2739): polls the upload status for their
 * import jobs and the photos still processing, keeps what it learns per photo, refreshes the timeline
 * as photos become ready (throttled) and once more when processing ends, and notices a stall.
 */
export function useUploadProcessing(items: UploadItem[], isUploading: boolean): UploadProcessing {
  const [outcomes, setOutcomes] = useState<ServerOutcomes>(NO_OUTCOMES);
  // A closed card starts the next one afresh.
  if (items.length === 0 && outcomes !== NO_OUTCOMES) setOutcomes(NO_OUTCOMES);

  const jobIds = useMemo(() => followedJobIds(items), [items]);
  const asked = useMemo(() => pendingUploads(items, outcomes), [items, outcomes]);
  const askedIds = asked.map(item => item.photoId).join(",");
  const params = useMemo(() => ({ jobIds, photoIds: askedIds ? askedIds.split(",") : [] }), [jobIds, askedIds]);
  const { data, isPlaceholderData, dataUpdatedAt } = useUploadStatusQuery(
    params,
    activeWhile(isUploading, items, outcomes)
  );

  // Each answer is absorbed once, with the photos it was asked about.
  const absorbedAt = useRef(0);
  useEffect(() => {
    if (!data || isPlaceholderData || absorbedAt.current === dataUpdatedAt) return;
    absorbedAt.current = dataUpdatedAt;
    setOutcomes(previous => absorbStatus(previous, data, asked));
  }, [data, isPlaceholderData, dataUpdatedAt, asked]);

  const phase = processingPhase(items, outcomes, data);
  useRefreshAsPhotosArrive(outcomes.ready.size, phase);

  const counts = importCounts(data ? followedJobs(data, jobIds) : []);
  const openImports = useMemo(() => data?.imports.filter(job => !job.finished) ?? [], [data]);
  const stalledMinutes = useStall(`${counts.ready}/${counts.total}/${outcomes.ready.size}`, dataUpdatedAt);
  return {
    phase,
    outcomes,
    counts,
    stalledMinutes: phase === "processing" && !isUploading ? stalledMinutes : null,
    openImports,
  };
}

/** Refreshes the photo lists as photos become ready, at most every REFRESH_EVERY_MS, and when processing ends. */
function useRefreshAsPhotosArrive(readyCount: number, phase: ProcessingPhase): void {
  const refreshedAt = useRef(0);
  useEffect(() => {
    const now = Date.now();
    if (readyCount === 0 || now - refreshedAt.current < REFRESH_EVERY_MS) return;
    refreshedAt.current = now;
    invalidateUploadQueries();
  }, [readyCount]);

  const previous = useRef(phase);
  useEffect(() => {
    if (previous.current === "processing" && (phase === "followups" || phase === "done")) {
      invalidateProcessedUploads();
    }
    previous.current = phase;
  }, [phase]);
}

/** Whole minutes since `progress` last changed (by the answers' clock), once that is STALL_AFTER_MS. */
function useStall(progress: string, answeredAt: number): number | null {
  const [mark, setMark] = useState({ progress, at: answeredAt });
  // Counted from the first answer: before it, `answeredAt` is 0.
  if (mark.progress !== progress || (mark.at !== answeredAt && mark.at === 0)) setMark({ progress, at: answeredAt });
  const quiet = answeredAt - mark.at;
  return quiet >= STALL_AFTER_MS ? Math.floor(quiet / MINUTE_MS) : null;
}
