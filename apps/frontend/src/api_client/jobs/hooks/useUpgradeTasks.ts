import { endpoints, jobKeys, pollWhile } from "@librephotos/api-client";
import type { UpgradeTask, UpgradeTaskList } from "@librephotos/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api";
import { startJob } from "../startJob";

/** A task the card still counts: not done yet. */
export function isOpenTask(task: UpgradeTask): boolean {
  return task.status !== "done";
}

/**
 * The Finish the upgrade card's tasks (#2322). Admins only: pass `enabled: false` for everyone else,
 * whom the server refuses. Every two seconds while a task's job runs, so its progress moves.
 */
export const useUpgradeTasksQuery = ({ enabled }: { enabled: boolean }) =>
  useQuery({
    queryKey: jobKeys.upgradeTasks(),
    queryFn: () => endpoints.fetchUpgradeTasks(apiClient),
    // Not at all while nothing runs: a task only changes when a job does, which refreshes it.
    refetchInterval: pollWhile<UpgradeTaskList>(list => list.tasks.some(task => task.status === "running"), false),
    enabled,
  });

/** Start (or retry) a task. Its job shows in the job list and the worker ring too. */
export const useStartUpgradeTaskMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (key: string) => startJob(() => endpoints.startUpgradeTask(apiClient, key)),
    onSettled: () =>
      Promise.all([
        // Under jobKeys.all, so the card's tasks refresh with the job list.
        queryClient.invalidateQueries({ queryKey: jobKeys.all }),
        queryClient.invalidateQueries({ queryKey: jobKeys.worker() }),
      ]),
  });
};

/** Not now: hide an optional task for good. The answer is the tasks left. */
export const useDismissUpgradeTaskMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (key: string) => endpoints.dismissUpgradeTask(apiClient, key),
    onSuccess: list => {
      queryClient.setQueryData(jobKeys.upgradeTasks(), list);
    },
  });
};

/** How many tasks the update left for an admin to see through (the account menu's count); 0 for others. */
export function useOpenUpgradeTaskCount(isAdmin: boolean): number {
  const { data } = useUpgradeTasksQuery({ enabled: isAdmin });
  return isAdmin ? (data?.tasks.filter(isOpenTask).length ?? 0) : 0;
}
