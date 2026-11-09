// The grid images this page has shown. A tile mounts again whenever it scrolls back into the
// grid's window; one whose picture is here shows it at once, from the browser's cache, instead of
// its placeholder and a fade. A few thousand addresses are a few hundred kilobytes.
const MAX_REMEMBERED = 5000;
const loaded = new Set<string>();

/** Whether the picture at `src` has loaded on this page before. */
export function hasLoaded(src: string): boolean {
  return loaded.has(src);
}

/** Note that the picture at `src` has loaded. */
export function rememberLoaded(src: string): void {
  if (loaded.has(src)) return;
  if (loaded.size >= MAX_REMEMBERED) {
    const oldest = loaded.values().next();
    if (!oldest.done) loaded.delete(oldest.value);
  }
  loaded.add(src);
}

/** Forget every picture (tests). */
export function forgetLoaded(): void {
  loaded.clear();
}
