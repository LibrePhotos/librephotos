const root = ["stats"] as const;

export const statsKeys = {
  all: root,
  counts: () => [...root, "counts"] as const,
  photoMonthCounts: () => [...root, "photoMonthCounts"] as const,
  locationTree: () => [...root, "locationTree"] as const,
  socialGraph: () => [...root, "socialGraph"] as const,
  wordCloud: () => [...root, "wordCloud"] as const,
  locationTimeline: () => [...root, "locationTimeline"] as const,
};
