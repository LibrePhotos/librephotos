import { IconCamera, IconCloudCheck, IconCloudOff, IconCloudUpload, IconMovie, IconPhoto } from "@tabler/icons-react";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { imageUrl } from "../ipc";
import { enqueueThumb, type Ticket } from "../lib/thumbQueue";
import type { LibraryFile } from "./api";
import { monthLabel } from "./dates";

const TARGET = 172;
const GAP = 4;
const HEADER = 44;
const OVERSCAN_PX = 600;

type Row =
  | { kind: "header"; top: number; label: string; count: number }
  | { kind: "items"; top: number; start: number; count: number };

export type Layout = { rows: Row[]; height: number; tile: number; columns: number };

/** Month groups (files are newest first), each a header row and rows of square tiles. */
export function layoutGrid(files: LibraryFile[], width: number): Layout {
  const columns = Math.max(2, Math.floor((width + GAP) / (TARGET + GAP)));
  const tile = Math.max(40, (width - (columns - 1) * GAP) / columns);
  const rows: Row[] = [];
  let top = 0;
  let i = 0;
  while (i < files.length) {
    const first = files[i];
    if (!first) break;
    const label = monthLabel(first.takenMs);
    let end = i + 1;
    while (end < files.length && monthLabel(files[end]?.takenMs ?? 0) === label) end++;
    rows.push({ kind: "header", top, label, count: end - i });
    top += HEADER;
    for (let s = i; s < end; s += columns) {
      rows.push({ kind: "items", top, start: s, count: Math.min(columns, end - s) });
      top += tile + GAP;
    }
    top += 12;
    i = end;
  }
  return { rows, height: top, tile, columns };
}

/** First row whose bottom is below `y` (rows are sorted by top). */
function firstRowAt(rows: Row[], y: number, tile: number): number {
  let lo = 0;
  let hi = rows.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const r = rows[mid];
    if (!r) break;
    const bottom = r.top + (r.kind === "header" ? HEADER : tile);
    if (bottom < y) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function RemoteBadge({ file }: { file: LibraryFile }) {
  switch (file.remote) {
    case "present":
      return (
        <span className="lib-badge remote ok" title="On LibrePhotos">
          <IconCloudCheck size={14} stroke={2} />
        </span>
      );
    case "uploading":
      return (
        <span className="lib-badge remote busy" title="Uploading">
          <IconCloudUpload size={14} stroke={2} />
        </span>
      );
    case "absent":
    case "failed":
      return (
        <span className={`lib-badge remote local${file.remote === "failed" ? " failed" : ""}`} title={file.remote === "failed" ? "Upload failed" : "Only on this computer"}>
          <IconCloudOff size={14} stroke={2} />
        </span>
      );
    default:
      return null;
  }
}

const Tile = memo(function Tile({
  file,
  index,
  left,
  size,
  rowTop,
  center,
  showRemote,
  onOpen,
}: {
  file: LibraryFile;
  index: number;
  left: number;
  size: number;
  rowTop: number;
  center: RefObject<number>;
  showRemote: boolean;
  onOpen(index: number): void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const ticket = useRef<Ticket | null>(null);
  const url = imageUrl(file, "thumb", 0, 0, "low");
  const topRef = useRef(rowTop);
  topRef.current = rowTop;
  useEffect(() => {
    // Visible tiles load nearest the middle of the view first (see lib/thumbQueue.ts).
    const t = enqueueThumb(
      () => Math.abs(topRef.current - center.current) + left / 1000,
      () => setSrc(url),
    );
    ticket.current = t;
    return () => t.cancel();
  }, [url, center, left]);
  const settle = () => ticket.current?.release();
  const Fallback = file.kind === "video" ? IconMovie : file.kind === "raw" ? IconCamera : IconPhoto;
  return (
    <button
      type="button"
      className="lib-tile"
      style={{ left, width: size, height: size }}
      title={file.name}
      aria-label={file.name}
      onClick={() => onOpen(index)}
    >
      {failed || !src ? (
        <span className="lib-tile-fallback">{failed && <Fallback size={22} stroke={1.5} />}</span>
      ) : (
        <img
          src={src}
          alt=""
          decoding="async"
          draggable={false}
          onLoad={settle}
          onError={() => {
            settle();
            setFailed(true);
          }}
        />
      )}
      {file.kind === "video" && (
        <span className="lib-badge kind">
          <IconMovie size={13} stroke={2} />
        </span>
      )}
      {file.kind === "raw" && <span className="lib-badge kind text">RAW</span>}
      {showRemote && <RemoteBadge file={file} />}
    </button>
  );
});

/** Virtualised, month-grouped grid of square tiles: only the rows in view are in the DOM. */
export function Grid({
  files,
  showRemote,
  onOpen,
  scrollKey,
}: {
  files: LibraryFile[];
  showRemote: boolean;
  onOpen(index: number): void;
  /** Scroll back to the top when this changes (a new list, not a refresh of the same one). */
  scrollKey: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ top: 0, height: 0, width: 0 });
  const center = useRef(0);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let frame = 0;
    const read = () => {
      frame = 0;
      setView(prev =>
        prev.top === el.scrollTop && prev.height === el.clientHeight && prev.width === el.clientWidth
          ? prev
          : { top: el.scrollTop, height: el.clientHeight, width: el.clientWidth },
      );
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    read();
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    el.addEventListener("scroll", schedule, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", schedule);
      cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [scrollKey]);

  const layout = useMemo(() => layoutGrid(files, Math.max(0, view.width - 32)), [files, view.width]);
  center.current = view.top + view.height / 2;

  const from = firstRowAt(layout.rows, view.top - OVERSCAN_PX, layout.tile);
  const bottom = view.top + view.height + OVERSCAN_PX;
  const out = [];
  for (let r = from; r < layout.rows.length; r++) {
    const row = layout.rows[r];
    if (!row || row.top > bottom) break;
    if (row.kind === "header") {
      out.push(
        <div key={`h${row.top}`} className="lib-month" style={{ top: row.top, height: HEADER }}>
          <span className="lib-month-label">{row.label}</span>
          <span className="lib-month-count">{row.count.toLocaleString()}</span>
        </div>,
      );
      continue;
    }
    for (let c = 0; c < row.count; c++) {
      const i = row.start + c;
      const f = files[i];
      if (!f) continue;
      out.push(
        <div key={`${f.path}|${f.modifiedMs}`} className="lib-tile-slot" style={{ top: row.top }}>
          <Tile
            file={f}
            index={i}
            left={c * (layout.tile + GAP)}
            size={layout.tile}
            rowTop={row.top}
            center={center}
            showRemote={showRemote}
            onOpen={onOpen}
          />
        </div>,
      );
    }
  }

  return (
    <div ref={scrollRef} className="lib-scroll" data-testid="library-grid">
      <div className="lib-canvas" style={{ height: layout.height }}>
        {view.width > 0 && out}
      </div>
    </div>
  );
}
