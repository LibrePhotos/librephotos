const root = ["folders"] as const;

export const folderKeys = {
  all: root,
  dirTree: (path: string) => [...root, "dirTree", path] as const,
  nextcloudDirs: () => [...root, "nextcloudDirs"] as const,
};
