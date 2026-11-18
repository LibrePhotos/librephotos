import { IconChevronLeft, IconChevronRight, IconPhotoOff } from "@tabler/icons-react";
import { useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref } from "react";
import { imageUrl, tileInfo, type FileEntry, type TileInfo } from "../ipc";
import { load } from "../lib/imageCache";
import { useImageInfo } from "../lib/infoCache";
import { Viewport, type ViewState } from "../lib/viewport";
import { setZoomPercent } from "../lib/zoomStore";
import { TileLayer } from "./tileLayer";
import { tokenOf, useProgressiveImage, type Box, type Shown } from "./useProgressiveImage";
import "./Stage.css";

export type StageHandle = {
  zoomIn(): void;
  zoomOut(): void;
  home(): void;
  actualSize(): void;
  toggleActual(): void;
  rotateView(dir: 1 | -1): void;
};

type Props = {
  file: FileEntry;
  neighbours: FileEntry[];
  handleRef: Ref<StageHandle | null>;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev(): void;
  onNext(): void;
  /** The pointer has been idle: hide the on-stage arrows. */
  idle: boolean;
};

type Size = { w: number; h: number };

const BOX_DEBOUNCE_MS = 220;

/** CSS size of an element, live, plus the device-pixel box for `screen` requests (debounced). */
export function useStageSize(ref: React.RefObject<HTMLElement | null>): { size: Size; box: Box | null } {
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
  const [box, setBox] = useState<Box | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let timer = 0;
    let first = true;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      const next = { w: rect.width, h: rect.height };
      setSize(prev => (prev.w === next.w && prev.h === next.h ? prev : next));
      if (next.w < 1 || next.h < 1) return;
      const dpr = window.devicePixelRatio || 1;
      const nextBox = { w: Math.round(next.w * dpr), h: Math.round(next.h * dpr) };
      const commit = () => setBox(prev => (prev && prev.w === nextBox.w && prev.h === nextBox.h ? prev : nextBox));
      window.clearTimeout(timer);
      if (first) commit();
      else timer = window.setTimeout(commit, BOX_DEBOUNCE_MS);
      first = false;
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      ro.disconnect();
      window.clearTimeout(timer);
    };
  }, [ref]);
  return { size, box };
}

export function Stage({ file, neighbours, handleRef, hasPrev, hasNext, onPrev, onNext, idle }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const { size, box } = useStageSize(rootRef);
  const isVideo = file.kind === "video";

  return (
    <div ref={rootRef} className={`stage lp-dark${idle ? " idle" : ""}`}>
      {isVideo ? (
        <VideoView key={tokenOf(file)} file={file} handleRef={handleRef} />
      ) : (
        <PhotoView file={file} neighbours={neighbours} size={size} box={box} handleRef={handleRef} />
      )}
      {hasPrev && (
        <button type="button" className="stage-nav prev" aria-label="Previous (Left arrow)" onClick={onPrev}>
          <IconChevronLeft size={22} stroke={2} aria-hidden="true" />
        </button>
      )}
      {hasNext && (
        <button type="button" className="stage-nav next" aria-label="Next (Right arrow)" onClick={onNext}>
          <IconChevronRight size={22} stroke={2} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

function Unsupported({ name, video }: { name: string; video: boolean }) {
  return (
    <div className="stage-message" role="status">
      <IconPhotoOff size={40} stroke={1.25} aria-hidden="true" />
      <div className="stage-message-name">{name}</div>
      <div className="stage-message-text">
        {video ? "This video can't be played yet" : "This format can't be shown yet"}
      </div>
    </div>
  );
}

function VideoView({ file, handleRef }: { file: FileEntry; handleRef: Ref<StageHandle | null> }) {
  const [failed, setFailed] = useState(false);
  useImperativeHandle<StageHandle | null, null>(handleRef, () => null, []);
  useEffect(() => setZoomPercent(null), []);
  if (failed) return <Unsupported name={file.name} video />;
  return (
    <video
      className="stage-video"
      src={imageUrl(file, "full")}
      controls
      autoPlay
      playsInline
      onError={() => setFailed(true)}
    />
  );
}

type Dims = { w: number; h: number };

/** `tile_info` per file version: big pictures get a tile pyramid instead of `full`. */
const tileInfos = new Map<string, Promise<TileInfo | null>>();
function tileInfoOf(file: FileEntry): Promise<TileInfo | null> {
  const token = tokenOf(file);
  let p = tileInfos.get(token);
  if (!p) {
    p = file.kind === "video" ? Promise.resolve(null) : tileInfo(file.path).catch(() => null);
    tileInfos.set(token, p);
    if (tileInfos.size > 64) {
      const oldest = tileInfos.keys().next().value;
      if (oldest !== undefined) tileInfos.delete(oldest);
    }
  }
  return p;
}

/** Original pixel size: aspect from the best decoded layer, long edge from the best source we have. */
function originalDims(shown: Shown | null, infoLongEdge: number | null, box: Box | null): Dims | null {
  if (!shown) return null;
  const best = shown.full ?? shown.screen ?? shown.thumb;
  if (!best || best.w <= 0 || best.h <= 0) return null;
  let long: number;
  if (shown.full) long = Math.max(shown.full.w, shown.full.h);
  else if (infoLongEdge) long = infoLongEdge;
  else if (shown.screen) long = Math.max(shown.screen.w, shown.screen.h);
  else long = box ? Math.max(box.w, box.h) : 4000; // thumbnail only: assume it fills the stage
  const landscape = best.w >= best.h;
  const w = landscape ? long : Math.round((long * best.w) / best.h);
  const h = landscape ? Math.round((long * best.h) / best.w) : long;
  return { w, h };
}

function PhotoView({
  file,
  neighbours,
  size,
  box,
  handleRef,
}: {
  file: FileEntry;
  neighbours: FileEntry[];
  size: Size;
  box: Box | null;
  handleRef: Ref<StageHandle | null>;
}) {
  const token = tokenOf(file);
  const [fullFor, setFullFor] = useState<string | null>(null);
  // Big pictures zoom through a tile pyramid instead of loading `full` (CONTRACT.md "Tiles").
  const [tiled, setTiled] = useState<{ token: string; info: TileInfo } | null>(null);
  const shown = useProgressiveImage(file, box, fullFor === token);
  const infoState = useImageInfo(file);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tilesRef = useRef<TileLayer | null>(null);
  const detailAsked = useRef<string | null>(null);

  const info = infoState.status === "ready" && shown && infoState.info.path === shown.path ? infoState.info : null;
  const infoLong = info?.width && info.height ? Math.max(info.width, info.height) : null;
  const tileInfoNow = tiled?.token === token ? tiled.info : null;
  const dims = tileInfoNow ? { w: tileInfoNow.width, h: tileInfoNow.height } : originalDims(shown, infoLong, box);

  // Latest values for the viewport callback, which fires outside React renders.
  const latest = useRef({ shown, dims, token, file });
  latest.current = { shown, dims, token, file };

  /** Zoomed past the `screen` image: tiles when the picture has a pyramid, else `full`. */
  const wantDetail = (t: string, f: FileEntry) => {
    if (detailAsked.current === t) return;
    detailAsked.current = t;
    void tileInfoOf(f).then(ti => {
      if (latest.current.token !== t) return;
      if (ti) setTiled({ token: t, info: ti });
      else setFullFor(t);
    });
  };

  const onView = (state: ViewState) => {
    setZoomPercent(state.percent);
    surfaceRef.current?.classList.toggle("pannable", state.pannable);
    tilesRef.current?.invalidate();
    const { shown: s, dims: d, token: t, file: f } = latest.current;
    const screen = s?.screen;
    if (!s || s.token !== t || !screen || s.full || !d) return;
    const longScreen = Math.max(screen.w, screen.h);
    const longOrig = Math.max(d.w, d.h);
    const showing = (state.percent / 100) * longOrig; // device px the long edge spans now
    if (longOrig > longScreen * 1.02 && showing > longScreen * 1.1) wantDetail(t, f);
  };
  const onViewRef = useRef(onView);
  onViewRef.current = onView;
  const vpRef = useRef<Viewport | null>(null);
  vpRef.current ??= new Viewport(state => onViewRef.current(state));
  const vp = vpRef.current;

  useLayoutEffect(() => {
    vp.attach(layerRef.current);
    return () => vp.attach(null);
  }, [vp]);

  useLayoutEffect(() => {
    vp.setStage(size.w, size.h);
  }, [vp, size.w, size.h]);

  const shownToken = shown?.token ?? null;
  const contentToken = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!dims || !shownToken) return;
    const reset = contentToken.current !== shownToken;
    contentToken.current = shownToken;
    vp.setContent(dims.w, dims.h, reset);
  }, [vp, shownToken, dims?.w, dims?.h]);

  useEffect(() => () => setZoomPercent(null), []);

  // The tile layer lives as long as this file version shows tiles.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const layer = layerRef.current;
    if (!tileInfoNow || !canvas || !layer) return;
    const tl = new TileLayer(canvas, layer, latest.current.file, tileInfoNow);
    tilesRef.current = tl;
    tl.invalidate();
    return () => {
      tl.destroy();
      if (tilesRef.current === tl) tilesRef.current = null;
    };
  }, [tileInfoNow]);

  const baseW = shown?.token === token ? (shown.screen?.w ?? shown.thumb?.w ?? 0) : 0;
  useLayoutEffect(() => {
    tilesRef.current?.setScreenWidth(baseW);
  }, [baseW, tileInfoNow]);

  useImperativeHandle(
    handleRef,
    (): StageHandle => ({
      zoomIn: () => vp.zoomBy(1.25),
      zoomOut: () => vp.zoomBy(0.8),
      home: () => vp.goHome(true),
      actualSize: () => vp.actualSize(),
      toggleActual: () => vp.toggleActual(),
      rotateView: dir => vp.rotate(dir),
    }),
    [vp],
  );

  // Wheel and trackpad pinch (ctrlKey) zoom at the cursor; must be non-passive to stop page zoom.
  useEffect(() => {
    const el = surfaceRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? rect.height : 1;
      if (!e.ctrlKey && Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        vp.panBy(-e.deltaX * unit, 0);
        return;
      }
      const k = e.ctrlKey ? 0.01 : 0.0022;
      const delta = Math.max(-300, Math.min(300, e.deltaY * unit));
      vp.zoomBy(Math.exp(-delta * k), e.clientX - rect.left, e.clientY - rect.top, false);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [vp]);

  // Drag to pan (only when the picture is bigger than the stage).
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = surfaceRef.current;
    if (e.button !== 0 || !el?.classList.contains("pannable")) return;
    el.setPointerCapture(e.pointerId);
    el.classList.add("dragging");
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    vp.panBy(e.clientX - d.x, e.clientY - d.y);
    d.x = e.clientX;
    d.y = e.clientY;
  };
  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (drag.current?.id !== e.pointerId) return;
    drag.current = null;
    surfaceRef.current?.classList.remove("dragging");
  };
  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    vp.toggleActual(e.clientX - rect.left, e.clientY - rect.top);
  };

  // Prefetch the neighbours' `screen` (and thumbs) once the current picture is on screen.
  const screenReady = shown?.token === token && shown.screen !== null;
  const neighbourKey = neighbours.map(tokenOf).join("\n");
  const boxW = box?.w ?? 0;
  const boxH = box?.h ?? 0;
  const neighboursRef = useRef(neighbours);
  neighboursRef.current = neighbours;
  useEffect(() => {
    if (!screenReady || boxW <= 0) return;
    const ac = new AbortController();
    for (const n of neighboursRef.current) {
      if (n.kind === "video") continue;
      load(imageUrl(n, "thumb"), ac.signal).catch(() => undefined);
      load(imageUrl(n, "screen", boxW, boxH), ac.signal).catch(() => undefined);
    }
    // Abort on the next tick: when the user steps onto a neighbour, the stage picks up the same
    // in-flight request first, so it isn't cancelled and restarted.
    return () => void window.setTimeout(() => ac.abort(), 0);
  }, [screenReady, neighbourKey, boxW, boxH]);

  const stale = !shown || shown.token !== token;
  const failed = !stale && shown.failed;
  const empty = !shown || (!shown.thumb && !shown.screen && !shown.full);
  const showSpinner = !failed && (stale || empty);
  useEffect(() => {
    if (failed) setZoomPercent(null);
  }, [failed]);

  return (
    <div
      ref={surfaceRef}
      className="stage-surface"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={onDoubleClick}
    >
      <div ref={layerRef} className="stage-layer" hidden={failed || empty}>
        {shown?.thumb && <img className="stage-img thumb" src={shown.thumb.url} alt="" decoding="sync" draggable={false} />}
        {shown?.screen && <img className="stage-img" src={shown.screen.url} alt="" decoding="sync" draggable={false} />}
        {shown?.full && <img className="stage-img" src={shown.full.url} alt="" decoding="sync" draggable={false} />}
      </div>
      {tileInfoNow && <canvas ref={canvasRef} className="stage-tiles" hidden={failed || empty} aria-hidden="true" />}
      {failed && <Unsupported name={file.name} video={false} />}
      {showSpinner && <div className="stage-spinner" aria-label="Loading" role="progressbar" />}
      <span className="sr-only" aria-live="polite">
        {file.name}
      </span>
    </div>
  );
}

/** Ordered prefetch list: +1, -1, +2, -2. */
export function neighboursOf(files: FileEntry[], index: number): FileEntry[] {
  const out: FileEntry[] = [];
  for (const offset of [1, -1, 2, -2]) {
    const f = files[index + offset];
    if (f) out.push(f);
  }
  return out;
}

export function useNeighbours(files: FileEntry[], index: number): FileEntry[] {
  return useMemo(() => neighboursOf(files, index), [files, index]);
}
