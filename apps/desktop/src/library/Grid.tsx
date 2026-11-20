import { IconAlertTriangle, IconCamera, IconCloud, IconCloudCheck, IconCloudOff, IconCloudUpload, IconMovie, IconPhoto, IconPlayerPlayFilled } from "@tabler/icons-react";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { markInteraction } from "../db/database";
import { imageUrl } from "../ipc";
import { enqueueThumb, type Ticket } from "../lib/thumbQueue";
import { remoteThumbUrl, type LibraryFile } from "./api";
import { dayKey, dayKeyOfIso, groupDayLabel } from "./dates";
import { FALLBACK_ASPECT, firstBlockAt, justify, type Part, type Source } from "./layout";
import type { ServerHit } from "./serverApi";
import "./Grid.css";

const OVERSCAN_PX = 800;
const NO_HITS: ServerHit[] = [];
const MIN_WIDTH_WITH_COUNT = 250;
const GUTTER = 20;

const photos = (n: number) => `${n.toLocaleString()} ${n === 1 ? "photo" : "photos"}`;

function aspectOf(f: LibraryFile | undefined): number {
  if (!f || !f.width || !f.height) return FALLBACK_ASPECT;
  return Math.min(4, Math.max(0.25, f.width / f.height));
}

function dayParts<T>(items: T[], source: Source, keyOf: (item: T) => number | null, out: Part[]) {
  let i = 0;
  while (i < items.length) {
    const first = items[i];
    if (first === undefined) break;
    const key = keyOf(first);
    let end = i + 1;
    while (end < items.length) {
      const next = items[end];
      if (next === undefined || keyOf(next) !== key) break;
      end++;
    }
    out.push({ kind: "group", label: key === null ? "No date" : groupDayLabel(key), count: end - i, source, start: i, end });
    i = end;
  }
}

function RemoteBadge({ file }: { file: LibraryFile }) {
  switch (file.remote) {
    case "present":
      return (
        <span className="tile-badge" title="On LibrePhotos" data-remote="present">
          <IconCloudCheck size={14} stroke={2} aria-label="On LibrePhotos" />
        </span>
      );
    case "uploading":
    case "checking":
      return (
        <span className="tile-badge busy" title="Uploading to LibrePhotos" data-remote="uploading">
          <IconCloudUpload size={14} stroke={2} aria-label="Uploading" />
        </span>
      );
    case "failed":
      return (
        <span className="tile-badge" title="Upload failed" data-remote="failed">
          <IconAlertTriangle size={14} stroke={2} aria-label="Upload failed" />
        </span>
      );
    case "absent":
      return (
        <span className="tile-badge" title="Only on this computer" data-remote="absent">
          <IconCloudOff size={14} stroke={2} aria-label="Only on this computer" />
        </span>
      );
    default:
      return null;
  }
}

type TileProps = {
  file: LibraryFile;
  index: number;
  left: number;
  top: number;
  width: number;
  height: number;
  center: RefObject<number>;
  showRemote: boolean;
  onOpen(index: number): void;
};

const Tile = memo(function Tile({ file, index, left, top, width, height, center, showRemote, onOpen }: TileProps) {
  const [src, setSrc] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const ticket = useRef<Ticket | null>(null);
  const url = imageUrl(file, "thumb", 0, 0, "low");
  const topRef = useRef(top);
  topRef.current = top;
  useEffect(() => {
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
      className="tile"
      style={{ left, top, width, height }}
      title={file.name}
      aria-label={file.name}
      onClick={() => onOpen(index)}
    >
      {failed ? (
        <span className="tile-fallback">
          <Fallback size={22} stroke={1.5} />
        </span>
      ) : (
        src && (
          <img
            src={src}
            alt=""
            decoding="async"
            draggable={false}
            className={loaded ? "loaded" : undefined}
            onLoad={() => {
              settle();
              setLoaded(true);
            }}
            onError={() => {
              settle();
              setFailed(true);
            }}
          />
        )
      )}
      {file.kind === "raw" && <span className="tile-corner top-right tile-badge">RAW</span>}
      {(file.kind === "video" || (showRemote && file.remote !== "unknown")) && (
        <span className="tile-corner bottom">
          {showRemote ? <RemoteBadge file={file} /> : <span />}
          {file.kind === "video" && (
            <span className="tile-badge" aria-label="Video">
              <IconPlayerPlayFilled size={14} />
            </span>
          )}
        </span>
      )}
    </button>
  );
});

const RemoteTile = memo(function RemoteTile({
  hit,
  left,
  top,
  width,
  height,
  onOpen,
}: {
  hit: ServerHit;
  left: number;
  top: number;
  width: number;
  height: number;
  onOpen(hit: ServerHit): void;
}) {
  const [loaded, setLoaded] = useState(false);
  return (
    <button
      type="button"
      className="tile"
      style={{ left, top, width, height }}
      aria-label="Photo on LibrePhotos"
      onClick={() => onOpen(hit)}
      data-testid="remote-tile"
    >
      <img
        src={remoteThumbUrl(hit.imageHash)}
        alt=""
        decoding="async"
        draggable={false}
        className={loaded ? "loaded" : undefined}
        onLoad={() => setLoaded(true)}
      />
      <span className="tile-corner bottom">
        <span className="tile-badge" title="Only on LibrePhotos">
          <IconCloud size={14} stroke={2} aria-label="Only on LibrePhotos" />
        </span>
        {hit.video && (
          <span className="tile-badge" aria-label="Video">
            <IconPlayerPlayFilled size={14} />
          </span>
        )}
      </span>
    </button>
  );
});

export function Grid({
  files,
  showRemote,
  onOpen,
  scrollKey,
  remote,
  onOpenRemote,
  sections,
}: {
  files: LibraryFile[];
  showRemote: boolean;
  onOpen(index: number): void;
  scrollKey: string;
  remote?: ServerHit[];
  onOpenRemote?(hit: ServerHit): void;
  sections?: boolean;
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
    const onScroll = () => {
      markInteraction();
      schedule();
    };
    read();
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [scrollKey]);

  const hits = remote ?? NO_HITS;
  const parts = useMemo(() => {
    const out: Part[] = [];
    if (sections && files.length > 0) out.push({ kind: "section", id: "local", title: "On this computer", count: files.length });
    dayParts(files, 0, f => dayKey(f.takenMs), out);
    if (hits.length > 0) {
      if (sections) out.push({ kind: "section", id: "remote", title: "Only on LibrePhotos", count: hits.length });
      dayParts(hits, 1, h => dayKeyOfIso(h.date), out);
    }
    return out;
  }, [files, hits, sections]);

  const width = Math.max(0, view.width - 2 * GUTTER);
  const layout = useMemo(
    () => justify(parts, width, (source, i) => (source === 0 ? aspectOf(files[i]) : 1)),
    [parts, width, files],
  );
  center.current = view.top + view.height / 2;

  const from = firstBlockAt(layout.blocks, view.top - OVERSCAN_PX);
  const bottom = view.top + view.height + OVERSCAN_PX;
  const out = [];
  for (let b = from; b < layout.blocks.length; b++) {
    const block = layout.blocks[b];
    if (!block || block.top > bottom) break;
    if (block.kind === "section") {
      out.push(
        <div key={`s${block.id}`} className="grid-section" style={{ top: block.top, height: block.height }} data-testid={`section-${block.id}`}>
          <h2 className="grid-section-title">{block.title}</h2>
          <div className="grid-section-count">{photos(block.count)}</div>
        </div>,
      );
    } else if (block.kind === "header") {
      out.push(
        <div
          key={`h${block.top}|${block.left}`}
          className="grid-day"
          style={{ top: block.top, left: block.left, width: block.width, height: block.height }}
          title={block.width < MIN_WIDTH_WITH_COUNT ? `${block.label} · ${photos(block.count)}` : undefined}
        >
          <span className="grid-day-date">{block.label}</span>
          {block.width >= MIN_WIDTH_WITH_COUNT && <span className="grid-day-count">{photos(block.count)}</span>}
        </div>,
      );
    } else {
      for (const t of block.tiles) {
        if (t.source === 1) {
          const hit = hits[t.index];
          if (!hit || !onOpenRemote) continue;
          out.push(<RemoteTile key={`r${hit.imageHash}`} hit={hit} left={t.left} top={block.top} width={t.width} height={block.height} onOpen={onOpenRemote} />);
          continue;
        }
        const f = files[t.index];
        if (!f) continue;
        out.push(
          <Tile
            key={`${f.path}|${f.modifiedMs}`}
            file={f}
            index={t.index}
            left={t.left}
            top={block.top}
            width={t.width}
            height={block.height}
            center={center}
            showRemote={showRemote}
            onOpen={onOpen}
          />,
        );
      }
    }
  }

  return (
    <div ref={scrollRef} className="grid-scroll" data-testid="library-grid">
      <div className="grid-canvas" style={{ height: layout.height }}>
        {view.width > 0 && out}
      </div>
    </div>
  );
}
