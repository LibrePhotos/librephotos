import { useEffect, useRef, useState } from "react";
import { imageUrl, type FileEntry } from "../ipc";
import { load } from "../lib/imageCache";
import { useStageSize } from "./Stage";
import "./Slideshow.css";

const INTERVAL_MS = 3000;

type Frame = { key: string; url: string };

/**
 * Full-stage slideshow with a crossfade. The next picture is decoded before it is shown; videos and
 * pictures that fail to load are skipped. `onAdvance` moves the app's current index, so the filmstrip
 * and title follow, and leaving the slideshow lands on the last picture shown.
 */
export function Slideshow({
  files,
  index,
  onAdvance,
  onStop,
}: {
  files: FileEntry[];
  index: number;
  onAdvance(index: number): void;
  onStop(): void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const { box } = useStageSize(rootRef);
  const [frames, setFrames] = useState<Frame[]>([]);

  const urlOf = (f: FileEntry) => (box ? imageUrl(f, "screen", box.w, box.h) : "");

  // Show the current picture (crossfading over the previous frame) once it is decoded.
  const current = files[index];
  const currentUrl = current && box && current.kind !== "video" ? urlOf(current) : "";
  useEffect(() => {
    if (!currentUrl) return;
    let live = true;
    load(currentUrl).then(
      () => {
        if (!live) return;
        setFrames(prev => [...prev.slice(-1), { key: `${currentUrl}#${Date.now()}`, url: currentUrl }]);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [currentUrl]);

  // Every 3 s: find the next showable picture, decode it, then advance.
  const shownUrl = frames[frames.length - 1]?.url ?? "";
  useEffect(() => {
    if (!box || files.length === 0) return;
    let live = true;
    const timer = window.setTimeout(async () => {
      for (let step = 1; step <= files.length && live; step++) {
        const i = (index + step) % files.length;
        const f = files[i];
        if (!f || f.kind === "video") continue;
        try {
          await load(imageUrl(f, "screen", box.w, box.h));
          if (live) onAdvance(i);
          return;
        } catch {
          // skip pictures that can't be shown
        }
      }
    }, shownUrl || current?.kind === "video" ? INTERVAL_MS : 0);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [box, files, index, shownUrl, current?.kind, onAdvance]);

  return (
    <div ref={rootRef} className="slideshow" onClick={onStop} role="presentation">
      {frames.map((f, i) => (
        <img
          key={f.key}
          className={`slide${i === frames.length - 1 ? " top" : ""}`}
          src={f.url}
          alt=""
          decoding="sync"
          draggable={false}
        />
      ))}
    </div>
  );
}
