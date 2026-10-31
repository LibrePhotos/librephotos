import { endpoints, jobKeys, pollWhile } from "@librephotos/api-client";
import type { ProcessingStageKey, ProcessingStatus } from "@librephotos/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { apiClient } from "../../api";
import { startJob } from "../startJob";

/** Whether a stage's job is queued or running. */
function anyStageRunning(status: ProcessingStatus): boolean {
  return status.stages.some(stage => stage.running_job !== null);
}

/**
 * What each processing stage still has to do in the user's library (#2741). Every two seconds while
 * a stage's job runs, so its progress moves; not at all otherwise. A job started from this app
 * refreshes it (it is under `jobKeys.all`), and so do coming back to the window and the job queue
 * turning busy or idle (`queueBusy`, from the worker status): a scheduled scan, another tab.
 */
export function useProcessingStatusQuery(queueBusy: boolean) {
  const queryClient = useQueryClient();
  const lastBusy = useRef(queueBusy);
  useEffect(() => {
    if (lastBusy.current === queueBusy) return;
    lastBusy.current = queueBusy;
    void queryClient.invalidateQueries({ queryKey: jobKeys.processingStatus() });
  }, [queueBusy, queryClient]);

  return useQuery({
    queryKey: jobKeys.processingStatus(),
    queryFn: () => endpoints.fetchProcessingStatus(apiClient),
    refetchInterval: pollWhile<ProcessingStatus>(anyStageRunning, false),
    refetchOnWindowFocus: true,
  });
}

/** Run now: start the job that catches the stage up. Its job also shows in the job list and the worker ring. */
export const useRunProcessingStageMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (stage: ProcessingStageKey) => startJob(() => endpoints.runProcessingStage(apiClient, stage)),
    onSettled: () =>
      Promise.all([
        // Under jobKeys.all, so the status shows the stage's job running.
        queryClient.invalidateQueries({ queryKey: jobKeys.all }),
        queryClient.invalidateQueries({ queryKey: jobKeys.worker() }),
      ]),
  });
};

/**
 * Try again (#2888): ask the face model again about the faces it found no face in, then run the face
 * recognition data's job, as Run now does.
 */
export const useRetryUnmatchedFacesMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => startJob(() => endpoints.retryUnmatchedFaces(apiClient)),
    onSettled: () =>
      Promise.all([
        // Under jobKeys.all: the count of unmatched faces and the stage's job.
        queryClient.invalidateQueries({ queryKey: jobKeys.all }),
        queryClient.invalidateQueries({ queryKey: jobKeys.worker() }),
      ]),
  });
};
