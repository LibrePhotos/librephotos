import { useEffect, useRef, useState } from "react";
import { imageUrl, type FileEntry } from "../ipc";
import { load } from "../lib/imageCache";
import { useStageSize } from "./Stage";
import "./Slideshow.css";

const INTERVAL_MS = 3000;

type Frame = { key: string; url: string };

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
