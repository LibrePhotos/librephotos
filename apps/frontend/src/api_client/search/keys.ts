// Search results are a grid: photoGridKeys.search (photos/keys.ts).
const root = ["search"] as const;

export const searchKeys = {
  all: root,
  examples: () => [...root, "examples"] as const,
};
