const root = ["server"] as const;

export const serverKeys = {
  all: root,
  imageTag: () => [...root, "imageTag"] as const,
  logs: (lines: number) => [...root, "logs", lines] as const,
  stats: () => [...root, "stats"] as const,
  storageStats: () => [...root, "storageStats"] as const,
};
