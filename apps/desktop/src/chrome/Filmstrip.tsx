import { IconCamera, IconMovie, IconPhoto } from "@tabler/icons-react";
import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { imageUrl, type FileEntry } from "../ipc";
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

const Thumb = memo(function Thumb({
  file,
  index,
  active,
  onSelect,
}: {
  file: FileEntry;
  index: number;
  active: boolean;
  onSelect(index: number): void;
}) {
  const [failed, setFailed] = useState(false);
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
        <img src={imageUrl(file, "thumb")} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setFailed(true)} />
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

  const first = Math.max(0, Math.floor((view.left - pad) / STEP) - OVERSCAN);
  const last = Math.min(files.length - 1, Math.ceil((view.left + view.width - pad) / STEP) + OVERSCAN);
  const items = [];
  for (let i = first; i <= last; i++) {
    const f = files[i];
    if (f) items.push(<Thumb key={`${f.path}|${f.modifiedMs}`} file={f} index={i} active={i === index} onSelect={onSelect} />);
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
