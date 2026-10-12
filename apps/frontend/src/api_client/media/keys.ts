const root = ["media"] as const;

export const mediaKeys = {
  all: root,
  diagnostics: (mediaHash: string | undefined) => [...root, "diagnostics", mediaHash] as const,
};
