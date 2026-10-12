import type { DuplicateType, ReviewStatus } from "./types";

const root = ["duplicates"] as const;

export const duplicateKeys = {
  all: root,
  list: (duplicateType?: DuplicateType, status?: ReviewStatus, page?: number, pageSize?: number) =>
    [...root, "list", duplicateType, status, page, pageSize] as const,
  detail: (id: string) => [...root, "detail", id] as const,
  stats: () => [...root, "stats"] as const,
};
