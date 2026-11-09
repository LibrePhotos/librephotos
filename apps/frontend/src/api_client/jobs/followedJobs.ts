/**
 * The jobs this tab started and waits on, one per kind. Kept outside React, so a page that is left
 * while its job runs shows the job running again when it is opened, and its end is still reported.
 * Gone on a page reload.
 */
export type FollowedJobKind = "applyDateRules" | "emptyTrash" | "writeMetadata";

const followed = new Map<FollowedJobKind, string>();
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach(listener => listener());
}

export const followedJobs = {
  follow(kind: FollowedJobKind, jobId: string): void {
    followed.set(kind, jobId);
    emit();
  },
  /** Stops following `jobId`; a newer job of the same kind stays followed. */
  release(kind: FollowedJobKind, jobId: string): void {
    if (followed.get(kind) !== jobId) return;
    followed.delete(kind);
    emit();
  },
  get(kind: FollowedJobKind): string | null {
    return followed.get(kind) ?? null;
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
