import { IconCamera, IconMovie, IconPhoto } from "@tabler/icons-react";
import { memo, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { imageUrl, type FileEntry } from "../ipc";
import { enqueueThumb, filmRank, type Ticket } from "../lib/thumbQueue";
import "./Filmstrip.css";

const ITEM = 56;
const GAP = 4;
const STEP = ITEM + GAP;
const OVERSCAN = 6;

type Props = {
  files: FileEntry[];
  index: number;
  onSelect(index: number): void;
  onPointerEnter(): void;
  onPointerLeave(): void;
};

/** What the load queue ranks by: the current item and the items actually in view. */
type Focus = { index: number; first: number; last: number };

const Thumb = memo(function Thumb({
  file,
  index,
  active,
  focus,
  onSelect,
}: {
  file: FileEntry;
  index: number;
  active: boolean;
  focus: RefObject<Focus>;
  onSelect(index: number): void;
}) {
  const [failed, setFailed] = useState(false);
  const [src, setSrc] = useState<string | null>(null);
  const ticket = useRef<Ticket | null>(null);
  const indexRef = useRef(index);
  indexRef.current = index;
  const url = imageUrl(file, "thumb", 0, 0, "low");
  useEffect(() => {
    const t = enqueueThumb(
      () => {
        const f = focus.current;
        return filmRank(indexRef.current, f.index, f.first, f.last);
      },
      () => setSrc(url),
    );
    ticket.current = t;
    return () => t.cancel();
  }, [url, focus]);
  const settle = () => ticket.current?.release();
  const Fallback = file.kind === "video" ? IconMovie : file.kind === "raw" ? IconCamera : IconPhoto;
  return (
    <button
      type="button"
      className={`film-item${active ? " active" : ""}`}
      style={{ left: index * STEP }}
      aria-label={file.name}
      aria-current={active ? "true" : undefined}
      tabIndex={active ? 0 : -1}
      onClick={() => onSelect(index)}
    >
      {failed ? (
        <Fallback size={20} stroke={1.5} />
      ) : (
        src && (
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
        )
      )}
      {file.kind === "video" && !failed && (
        <span className="film-badge" aria-hidden="true">
          <IconMovie size={12} stroke={2} />
        </span>
      )}
    </button>
  );
});

/** Virtualised strip: only the thumbs in view (plus a margin) are in the DOM. */
export function Filmstrip({ files, index, onSelect, onPointerEnter, onPointerLeave }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ left: 0, width: 0 });
  const centred = useRef(false);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let frame = 0;
    const read = () => {
      frame = 0;
      setView(prev =>
        prev.left === el.scrollLeft && prev.width === el.clientWidth ? prev : { left: el.scrollLeft, width: el.clientWidth },
      );
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    read();
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    el.addEventListener("scroll", schedule, { passive: true });
    // A vertical wheel scrolls the strip sideways.
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY * (e.deltaMode === 1 ? 16 : 1);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", schedule);
      el.removeEventListener("wheel", onWheel);
      cancelAnimationFrame(frame);
    };
  }, []);

  // Keep the current item centred. Padding of half the width lets the first and last centre too.
  const pad = Math.max(0, view.width / 2 - ITEM / 2);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || view.width === 0) return;
    const target = index * STEP;
    const distance = Math.abs(el.scrollLeft - target);
    const smooth = centred.current && distance < view.width * 1.5;
    el.scrollTo({ left: target, behavior: smooth ? "smooth" : "instant" });
    centred.current = true;
  }, [index, view.width, files.length]);

  // Until the first centring, rank and render around where the strip is about to scroll to.
  const left = centred.current ? view.left : index * STEP;
  const firstVisible = Math.floor((left - pad) / STEP);
  const lastVisible = Math.ceil((left + view.width - pad) / STEP);
  const focus = useRef<Focus>({ index, first: firstVisible, last: lastVisible });
  focus.current = { index, first: firstVisible, last: lastVisible };
  const first = Math.max(0, firstVisible - OVERSCAN);
  const last = view.width === 0 ? -1 : Math.min(files.length - 1, lastVisible + OVERSCAN);
  const items = [];
  for (let i = first; i <= last; i++) {
    const f = files[i];
    if (f)
      items.push(
        <Thumb key={`${f.path}|${f.modifiedMs}`} file={f} index={i} active={i === index} focus={focus} onSelect={onSelect} />,
      );
  }

  return (
    <nav className="filmstrip" aria-label="Filmstrip" onPointerEnter={onPointerEnter} onPointerLeave={onPointerLeave}>
      <div ref={scrollRef} className="film-scroll">
        <div className="film-track" style={{ width: files.length * STEP - GAP + pad * 2 }}>
          <div className="film-items" style={{ left: pad }}>
            {items}
          </div>
        </div>
      </div>
    </nav>
  );
}
