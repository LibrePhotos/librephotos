const root = ["stacks"] as const;

export const stackKeys = {
  all: root,
  lists: () => [...root, "list"] as const,
  list: (filters: Record<string, unknown>) => [...stackKeys.lists(), filters] as const,
  details: () => [...root, "detail"] as const,
  detail: (id: string) => [...stackKeys.details(), id] as const,
  stats: () => [...root, "stats"] as const,
};
