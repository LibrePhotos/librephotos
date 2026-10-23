/**
 * The folders left out of a library (#791), as the tree edits them: server paths, compared as the
 * server spells them (a Windows path may mix "/" and "\").
 */

/** Whether `path` lies below `folder` (not `folder` itself). */
export function isBelow(path: string, folder: string): boolean {
  const base = folder.replace(/[\\/]+$/, "");
  return path.length > base.length + 1 && path.startsWith(base) && "\\/".includes(path.charAt(base.length));
}

/** Whether `path` is left out: listed itself, or below a listed folder. */
export function isLeftOut(excluded: readonly string[], path: string): boolean {
  return excluded.some(folder => folder === path || isBelow(path, folder));
}

/** The left-out folders below `folder`. */
export function leftOutBelow(excluded: readonly string[], folder: string): string[] {
  return excluded.filter(path => isBelow(path, folder));
}

/**
 * Tick or untick `path`. Unticking leaves it out and drops the folders below it, which it now
 * covers; ticking takes it back in.
 */
export function toggleLeftOut(excluded: readonly string[], path: string): string[] {
  if (excluded.includes(path)) {
    return excluded.filter(folder => folder !== path);
  }
  return [...excluded.filter(folder => !isBelow(folder, path)), path].sort();
}

/** The folders left out now that were not before. */
export function newlyLeftOut(saved: readonly string[], draft: readonly string[]): string[] {
  return draft.filter(path => !isLeftOut(saved, path));
}
