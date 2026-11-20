export type ViewState = {
  percent: number;
  pannable: boolean;
  atHome: boolean;
};

const MAX_DEVICE_ZOOM = 16;
const EASE = "transform 220ms cubic-bezier(0.2, 0, 0, 1)";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export class Viewport {
  private sw = 0;
  private sh = 0;
  private iw = 0;
  private ih = 0;
  private turns = 0;
  private scale = 1;
  private tx = 0;
  private ty = 0;
  private atHome = true;
  private layer: HTMLElement | null = null;
  private readonly onChange: (state: ViewState) => void;

  constructor(onChange: (state: ViewState) => void) {
    this.onChange = onChange;
  }

  private get dpr(): number {
    return window.devicePixelRatio || 1;
  }
  private get odd(): boolean {
    return Math.abs(this.turns) % 2 === 1;
  }
  private get ew(): number {
    return this.odd ? this.ih : this.iw;
  }
  private get eh(): number {
    return this.odd ? this.iw : this.ih;
  }
  private get ready(): boolean {
    return this.iw > 0 && this.ih > 0 && this.sw > 0 && this.sh > 0;
  }

  fitScale(): number {
    return this.ready ? Math.min(this.sw / this.ew, this.sh / this.eh) : 1;
  }
  homeScale(): number {
    return Math.min(this.fitScale(), 1 / this.dpr);
  }
  private maxScale(): number {
    return Math.max(MAX_DEVICE_ZOOM / this.dpr, this.fitScale());
  }

  attach(layer: HTMLElement | null): void {
    this.layer = layer;
    if (layer) this.apply(false);
  }

  setStage(w: number, h: number): void {
    if (w === this.sw && h === this.sh) return;
    this.sw = w;
    this.sh = h;
    if (this.atHome) this.goHome(false);
    else this.settle(false);
  }

  setContent(w: number, h: number, reset: boolean): void {
    if (reset) {
      this.iw = w;
      this.ih = h;
      this.turns = 0;
      this.goHome(false);
      return;
    }
    if (w === this.iw && h === this.ih) return;
    const oldEw = this.ew;
    this.iw = w;
    this.ih = h;
    if (this.atHome) {
      this.goHome(false);
      return;
    }
    if (oldEw > 0 && this.ew > 0) this.scale *= oldEw / this.ew;
    this.settle(false);
  }

  goHome(animate = true): void {
    this.scale = this.homeScale();
    this.tx = (this.sw - this.ew * this.scale) / 2;
    this.ty = (this.sh - this.eh * this.scale) / 2;
    this.atHome = true;
    this.apply(animate);
  }

  zoomTo(target: number, px = this.sw / 2, py = this.sh / 2, animate = true): void {
    if (!this.ready) return;
    const next = clamp(target, this.homeScale(), this.maxScale());
    const ix = (px - this.tx) / this.scale;
    const iy = (py - this.ty) / this.scale;
    this.tx = px - ix * next;
    this.ty = py - iy * next;
    this.scale = next;
    this.atHome = Math.abs(next - this.homeScale()) < 1e-6;
    if (this.atHome) {
      this.goHome(animate);
      return;
    }
    this.settle(animate);
  }

  zoomBy(factor: number, px?: number, py?: number, animate = true): void {
    this.zoomTo(this.scale * factor, px, py, animate);
  }

  toggleActual(px = this.sw / 2, py = this.sh / 2): void {
    const actual = 1 / this.dpr;
    const near = (a: number, b: number) => Math.abs(a - b) / b < 0.01;
    if (near(this.scale, actual)) {
      if (near(this.homeScale(), actual)) this.zoomTo(this.fitScale(), px, py);
      else this.goHome(true);
    } else this.zoomTo(actual, px, py);
  }

  actualSize(): void {
    this.zoomTo(1 / this.dpr);
  }

  panBy(dx: number, dy: number): void {
    this.tx += dx;
    this.ty += dy;
    this.settle(false);
  }

  rotate(dir: 1 | -1): void {
    this.turns += dir;
    this.goHome(true);
  }

  private settle(animate: boolean): void {
    this.scale = clamp(this.scale, this.homeScale(), this.maxScale());
    const dw = this.ew * this.scale;
    const dh = this.eh * this.scale;
    this.tx = dw <= this.sw ? (this.sw - dw) / 2 : clamp(this.tx, this.sw - dw, 0);
    this.ty = dh <= this.sh ? (this.sh - dh) / 2 : clamp(this.ty, this.sh - dh, 0);
    this.apply(animate);
  }

  private apply(animate: boolean): void {
    const el = this.layer;
    if (el && this.iw > 0) {
      const cx = this.tx + (this.ew * this.scale) / 2;
      const cy = this.ty + (this.eh * this.scale) / 2;
      el.style.transition = animate ? EASE : "none";
      el.style.width = `${this.iw}px`;
      el.style.height = `${this.ih}px`;
      el.style.transform =
        `translate(${cx}px, ${cy}px) scale(${this.scale}) rotate(${this.turns * 90}deg) ` +
        `translate(${-this.iw / 2}px, ${-this.ih / 2}px)`;
    }
    this.onChange({
      percent: this.scale * this.dpr * 100,
      pannable: this.ew * this.scale > this.sw + 0.5 || this.eh * this.scale > this.sh + 0.5,
      atHome: this.atHome,
    });
  }
}
