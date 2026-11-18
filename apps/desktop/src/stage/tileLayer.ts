/**
 * Deep-zoom tile layer: draws the tiles of a big picture's pyramid (CONTRACT.md "Tiles") on one
 * canvas over the stage, once the zoom goes beyond what the `screen` image resolves.
 *
 * - Geometry comes from the stage layer's *computed* transform, so the tiles follow the image
 *   exactly, also during CSS zoom/rotate transitions (redrawn every frame while one runs).
 * - Every tile corner is rounded to a device pixel and adjacent tiles share corners, so there
 *   are never gaps at fractional zoom; tiles carry a 1 px border of their neighbours' pixels, which
 *   the canvas uses when it interpolates at a tile's edge, so magnified edges show no seam either.
 * - The level is the coarsest one with at least one tile pixel per device pixel. Missing tiles
 *   are drawn from the nearest loaded coarser tile meanwhile (and level+1 is fetched first), so
 *   panning never flashes back to the blurry `screen` image.
 * - Bounded: at most `MAX_INFLIGHT` fetches and `MAX_BITMAPS` decoded tiles (~1 MB each);
 *   everything is redrawn from refs in `requestAnimationFrame`, no React state per frame.
 */
import { tileRelease, tileUrl, type FileEntry, type TileInfo } from "../ipc";

const MAX_INFLIGHT = 6;
const MAX_BITMAPS = 128;
const RING_MAX_VISIBLE = 40;
/** Tiles appear once the picture shows this much more detail than the `screen` image has. */
const ACTIVE_ABOVE_SCREEN = 1.1;

type Tile = { bmp: ImageBitmap; used: number };
type Pt = { x: number; y: number };

const key = (l: number, x: number, y: number) => `${l}/${x}/${y}`;
/** Tiles overlap their neighbours by 1 px (CONTRACT.md "Tiles"): all but the first column/row start 1 px early. */
const border = (i: number) => (i > 0 ? 1 : 0);

declare global {
  interface Window {
    /** The live tile layer, for inspection from DevTools (`__lpTiles.stats()`). */
    __lpTiles?: TileLayer;
  }
}

export class TileLayer {
  private readonly canvas: HTMLCanvasElement;
  private readonly layer: HTMLElement;
  private readonly file: FileEntry;
  private readonly info: TileInfo;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly tiles = new Map<string, Tile>();
  private readonly inflight = new Map<string, AbortController>();
  private readonly failed = new Set<string>();
  private readonly ro: ResizeObserver;
  /** Width of the best non-tile image (screen/thumb), in its own pixels. */
  private screenW = 0;
  private frame = 0;
  private raf = 0;
  private animating = false;
  private blank = true;
  private destroyed = false;

  constructor(canvas: HTMLCanvasElement, layer: HTMLElement, file: FileEntry, info: TileInfo) {
    this.canvas = canvas;
    this.layer = layer;
    this.file = file;
    this.info = info;
    this.ctx = canvas.getContext("2d", { alpha: true });
    this.ro = new ResizeObserver(entries => {
      for (const e of entries) {
        const box = e.devicePixelContentBoxSize?.[0];
        const dpr = window.devicePixelRatio || 1;
        const w = box ? box.inlineSize : Math.round(e.contentRect.width * dpr);
        const h = box ? box.blockSize : Math.round(e.contentRect.height * dpr);
        if (w !== canvas.width || h !== canvas.height) {
          canvas.width = w;
          canvas.height = h;
          this.blank = true;
        }
      }
      this.invalidate();
    });
    try {
      this.ro.observe(canvas, { box: "device-pixel-content-box" });
    } catch {
      this.ro.observe(canvas);
    }
    window.__lpTiles = this;
    // Created while a zoom animation runs (tile_info answered mid-way): it already fired transitionrun.
    this.animating = layer.getAnimations().some(a => a instanceof CSSTransition && a.transitionProperty === "transform");
    layer.addEventListener("transitionrun", this.onTransitionRun);
    layer.addEventListener("transitionend", this.onTransitionEnd);
    layer.addEventListener("transitioncancel", this.onTransitionEnd);
  }

  setScreenWidth(w: number): void {
    if (w === this.screenW) return;
    this.screenW = w;
    this.invalidate();
  }

  /** The view changed: redraw on the next frame. */
  invalidate(): void {
    if (this.destroyed || this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.draw();
      if (this.animating) this.invalidate();
    });
  }

  destroy(): void {
    this.destroyed = true;
    if (window.__lpTiles === this) window.__lpTiles = undefined;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.layer.removeEventListener("transitionrun", this.onTransitionRun);
    this.layer.removeEventListener("transitionend", this.onTransitionEnd);
    this.layer.removeEventListener("transitioncancel", this.onTransitionEnd);
    for (const ac of this.inflight.values()) ac.abort();
    this.inflight.clear();
    for (const t of this.tiles.values()) t.bmp.close();
    this.tiles.clear();
    void tileRelease(this.file.path).catch(() => undefined);
  }

  /** For tests and the debug overlay. */
  stats(): { bitmaps: number; inflight: number; level: number | null } {
    return { bitmaps: this.tiles.size, inflight: this.inflight.size, level: this.lastLevel };
  }

  private lastLevel: number | null = null;

  private readonly onTransitionRun = (e: TransitionEvent) => {
    if (e.target !== this.layer || e.propertyName !== "transform") return;
    this.animating = true;
    this.invalidate();
  };

  private readonly onTransitionEnd = (e: TransitionEvent) => {
    if (e.target !== this.layer || e.propertyName !== "transform") return;
    this.animating = false;
    this.invalidate();
  };

  private clear(): void {
    if (this.blank || !this.ctx) return;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.blank = true;
  }

  /** Full-resolution image px -> canvas device px. */
  private matrix(): DOMMatrix | null {
    const cssW = this.canvas.clientWidth;
    const cssH = this.canvas.clientHeight;
    const lw = this.layer.offsetWidth;
    const lh = this.layer.offsetHeight;
    if (cssW <= 0 || cssH <= 0 || lw <= 0 || lh <= 0 || this.canvas.width <= 0) return null;
    const t = getComputedStyle(this.layer).transform;
    const m = new DOMMatrix(t && t !== "none" ? t : undefined);
    // The canvas and the layer share the stage surface's origin.
    return new DOMMatrix()
      .scale(this.canvas.width / cssW, this.canvas.height / cssH)
      .multiply(m)
      .scale(lw / this.info.width, lh / this.info.height);
  }

  private draw(): void {
    const ctx = this.ctx;
    const m = this.matrix();
    if (!ctx || !m) return this.clear();
    const { width: W, height: H, tileSize: T, levels } = this.info;
    const z = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)); // device px per image px
    if (!(z > 0) || z * W <= this.screenW * ACTIVE_ABOVE_SCREEN) {
      this.lastLevel = null;
      for (const ac of this.inflight.values()) ac.abort();
      this.inflight.clear();
      return this.clear();
    }
    // Levels coarser than the screen image are no better than what is under the canvas.
    const usable = (l: number) => W / 2 ** l > this.screenW;
    const level = Math.max(0, Math.min(levels - 1, Math.floor(Math.log2(1 / z) + 1e-6)));
    this.lastLevel = level;
    const frame = ++this.frame;

    // Visible image rectangle (full-res px).
    const inv = m.inverse();
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const corners = [
      inv.transformPoint({ x: 0, y: 0 }),
      inv.transformPoint({ x: cw, y: 0 }),
      inv.transformPoint({ x: 0, y: ch }),
      inv.transformPoint({ x: cw, y: ch }),
    ];
    const minX = Math.max(0, Math.min(...corners.map(p => p.x)));
    const maxX = Math.min(W, Math.max(...corners.map(p => p.x)));
    const minY = Math.max(0, Math.min(...corners.map(p => p.y)));
    const maxY = Math.min(H, Math.max(...corners.map(p => p.y)));
    if (maxX <= minX || maxY <= minY) return this.clear();
    const centre = inv.transformPoint({ x: cw / 2, y: ch / 2 });

    const range = (l: number, ring: number) => {
      const span = T * 2 ** l;
      const cols = Math.ceil(Math.ceil(W / 2 ** l) / T);
      const rows = Math.ceil(Math.ceil(H / 2 ** l) / T);
      return {
        x0: Math.max(0, Math.floor(minX / span) - ring),
        x1: Math.min(cols - 1, Math.ceil(maxX / span) - 1 + ring),
        y0: Math.max(0, Math.floor(minY / span) - ring),
        y1: Math.min(rows - 1, Math.ceil(maxY / span) - 1 + ring),
        span,
      };
    };

    // Device position of an image point, rounded so neighbours share edges exactly.
    const dev = (x: number, y: number): Pt => {
      const p = m.transformPoint({ x, y });
      return { x: Math.round(p.x), y: Math.round(p.y) };
    };
    const put = (bmp: ImageBitmap, x0: number, y0: number, x1: number, y1: number, sx: number, sy: number, sw: number, sh: number) => {
      const p00 = dev(x0, y0);
      const p10 = dev(x1, y0);
      const p01 = dev(x0, y1);
      ctx.setTransform((p10.x - p00.x) / sw, (p10.y - p00.y) / sw, (p01.x - p00.x) / sh, (p01.y - p00.y) / sh, p00.x, p00.y);
      ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, sw, sh);
    };

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = z < 0.75 ? "medium" : "low";
    this.blank = false;

    const want: { k: string; l: number; x: number; y: number; prio: number }[] = [];
    const vis = range(level, 0);
    const missing: [number, number][] = [];
    const ready: [number, number, Tile][] = [];
    for (let ty = vis.y0; ty <= vis.y1; ty++) {
      for (let tx = vis.x0; tx <= vis.x1; tx++) {
        const t = this.tiles.get(key(level, tx, ty));
        if (t) ready.push([tx, ty, t]);
        else missing.push([tx, ty]);
      }
    }
    // Fallback first: the nearest loaded coarser tile, cropped to the missing tile's area.
    for (const [tx, ty] of missing) {
      const x0 = tx * vis.span;
      const y0 = ty * vis.span;
      const x1 = Math.min(W, x0 + vis.span);
      const y1 = Math.min(H, y0 + vis.span);
      for (let p = level + 1; p < levels && usable(p); p++) {
        const k = p - level;
        const parent = this.tiles.get(key(p, tx >> k, ty >> k));
        if (!parent) continue;
        parent.used = frame;
        const s = 2 ** p;
        // The parent bitmap starts 1 px before its tile (overlap) unless it is in the first column/row.
        const ox = (tx >> k) * T - border(tx >> k);
        const oy = (ty >> k) * T - border(ty >> k);
        const sx = x0 / s - ox;
        const sy = y0 / s - oy;
        const sw = Math.min((x1 - x0) / s, parent.bmp.width - sx);
        const sh = Math.min((y1 - y0) / s, parent.bmp.height - sy);
        if (sw > 0 && sh > 0) put(parent.bmp, x0, y0, x1, y1, sx, sy, sw, sh);
        break;
      }
    }
    const lw = Math.ceil(W / 2 ** level);
    const lh = Math.ceil(H / 2 ** level);
    for (const [tx, ty, t] of ready) {
      t.used = frame;
      const x0 = tx * vis.span;
      const y0 = ty * vis.span;
      // Draw the tile's own pixels; its 1 px overlap border only feeds the interpolation at the edge.
      const iw = Math.min(T, lw - tx * T);
      const ih = Math.min(T, lh - ty * T);
      put(t.bmp, x0, y0, Math.min(W, x0 + vis.span), Math.min(H, y0 + vis.span), border(tx), border(ty), iw, ih);
    }

    // What to fetch: the coarser level under the view first (few tiles, quick fallback), then
    // this level nearest the centre, then a ring around the view for panning.
    const dist = (l: number, tx: number, ty: number) => {
      const span = T * 2 ** l;
      return Math.hypot((tx + 0.5) * span - centre.x, (ty + 0.5) * span - centre.y) / span;
    };
    if (level + 1 < levels && usable(level + 1)) {
      const c = range(level + 1, 0);
      for (let ty = c.y0; ty <= c.y1; ty++)
        for (let tx = c.x0; tx <= c.x1; tx++) want.push({ k: key(level + 1, tx, ty), l: level + 1, x: tx, y: ty, prio: dist(level + 1, tx, ty) });
    }
    for (const [tx, ty] of missing) want.push({ k: key(level, tx, ty), l: level, x: tx, y: ty, prio: 1000 + dist(level, tx, ty) });
    // The ring only while the view holds few tiles (it would double a dense view's memory).
    const ringR = range(level, missing.length + ready.length <= RING_MAX_VISIBLE ? 1 : 0);
    for (let ty = ringR.y0; ty <= ringR.y1; ty++)
      for (let tx = ringR.x0; tx <= ringR.x1; tx++) {
        if (tx >= vis.x0 && tx <= vis.x1 && ty >= vis.y0 && ty <= vis.y1) continue;
        want.push({ k: key(level, tx, ty), l: level, x: tx, y: ty, prio: 2000 + dist(level, tx, ty) });
      }
    want.sort((a, b) => a.prio - b.prio);
    const wanted = new Set<string>();
    for (const w of want) {
      wanted.add(w.k);
      const t = this.tiles.get(w.k);
      if (t) t.used = frame; // keep the ring and the fallback level alive
    }
    for (const [k, ac] of this.inflight) {
      if (!wanted.has(k)) {
        ac.abort();
        this.inflight.delete(k);
      }
    }
    // Mid-animation levels are only passed through: fetch once the zoom has settled.
    if (this.animating) return this.evict(frame);
    for (const w of want) {
      if (this.inflight.size >= MAX_INFLIGHT) break;
      if (this.tiles.has(w.k) || this.inflight.has(w.k) || this.failed.has(w.k)) continue;
      this.fetchTile(w.k, w.l, w.x, w.y);
    }
    this.evict(frame);
  }

  private fetchTile(k: string, l: number, x: number, y: number): void {
    const ac = new AbortController();
    this.inflight.set(k, ac);
    fetch(tileUrl(this.file, l, x, y), { signal: ac.signal })
      .then(r => (r.ok ? r.blob() : Promise.reject(new Error(`tile ${k}: HTTP ${r.status}`))))
      .then(b => createImageBitmap(b))
      .then(
        bmp => {
          if (this.inflight.get(k) === ac) this.inflight.delete(k);
          if (this.destroyed) return bmp.close();
          this.tiles.get(k)?.bmp.close();
          this.tiles.set(k, { bmp, used: this.frame });
          this.invalidate();
        },
        (err: unknown) => {
          if (this.inflight.get(k) === ac) this.inflight.delete(k);
          if (!(err instanceof DOMException && err.name === "AbortError")) this.failed.add(k);
          if (!this.destroyed) this.invalidate();
        },
      );
  }

  /** Over budget: close the least recently drawn bitmaps (never one drawn in this frame). */
  private evict(frame: number): void {
    if (this.tiles.size <= MAX_BITMAPS) return;
    const old = [...this.tiles].filter(([, t]) => t.used < frame).sort((a, b) => a[1].used - b[1].used);
    for (const [k, t] of old) {
      if (this.tiles.size <= MAX_BITMAPS) break;
      t.bmp.close();
      this.tiles.delete(k);
    }
  }
}
