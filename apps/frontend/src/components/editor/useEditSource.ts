import { useCallback, useEffect, useState } from "react";
import { releaseSource, useEditorServices } from "./editorServices";
import type { EditSource } from "./engine/editSource";

type Loaded = Readonly<{ key: string; source?: EditSource; failed?: boolean }>;

/**
 * The photo's edit source, fetched and decoded when the editor opens, and freed when the editor
 * closes; the browser revalidates its copy by ETag. While it downloads, the renderer's shaders are
 * compiled once, so the preview starts sooner. `retry` fetches it again after a failure.
 */
export function useEditSource(photoId: string) {
  const services = useEditorServices();
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const key = `${photoId}:${attempt}`;

  useEffect(() => {
    let live = true;
    let kept: EditSource | null = null;
    services.loadSource(photoId).then(
      source => {
        if (!live) {
          releaseSource(source);
          return;
        }
        kept = source;
        setLoaded({ key, source });
      },
      (error: unknown) => {
        console.warn("The edit source did not load", error);
        if (live) setLoaded({ key, failed: true });
      }
    );
    // In a task of its own, after the request went out (the API client awaits its token first):
    // the compile blocks the page for a moment, the download goes on meanwhile.
    const prepare = setTimeout(() => services.prepareRenderer(), 0);
    return () => {
      clearTimeout(prepare);
      live = false;
      if (kept) releaseSource(kept);
    };
  }, [photoId, key, services]);

  const retry = useCallback(() => setAttempt(previous => previous + 1), []);
  const current = loaded?.key === key ? loaded : null;
  return { source: current?.source ?? null, failed: current?.failed ?? false, retry };
}
