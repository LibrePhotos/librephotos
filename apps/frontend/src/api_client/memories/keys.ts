const root = ["memories"] as const;

export const memoryKeys = {
  all: root,
  list: (size?: number) => [...root, { size }] as const,
};
