// The screenshots in static/img/shots/: one entry per light/dark pair in manifest.json there.
// Plain TypeScript without JSX or a JSON import, so scripts/shots.test.mjs runs it in Node as is;
// the <Screenshot> component passes the manifest in.

export type Theme = "light" | "dark";

export type Shot = {
  id: string;
  /** Says what the shot shows; required, and checked by scripts/check-release-posts.mjs. */
  alt: string;
  width: number;
  height: number;
  /** The release the shot was taken for, when it shows a highlight of that release. */
  release?: string;
  /** Size of the phone variant (`<id>-phone-<theme>.webp`), when there is one. */
  phone?: { width: number; height: number };
};

/** The manifest entry for `id`. Throws for an unknown id, which fails `docusaurus build`. */
export function findShot(shots: readonly Shot[], id: string): Shot {
  const shot = shots.find((s) => s.id === id);
  if (!shot) {
    throw new Error(`<Screenshot id="${id}" />: no such shot in static/img/shots/manifest.json`);
  }
  return shot;
}

/** Site path of one theme's file, before the base URL. */
export function shotPath(id: string, theme: Theme): string {
  return `/img/shots/${id}-${theme}.webp`;
}
