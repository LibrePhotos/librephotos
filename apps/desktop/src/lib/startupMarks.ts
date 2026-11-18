/**
 * Start-up timing: performance marks for the first stage pixel (any layer) and the first sharp
 * one (`screen`/`full`), logged once to the console. Times are ms since navigation start; add
 * `performance.timeOrigin` for wall-clock time (to compare with the process start).
 */
const GIVE_UP_MS = 20_000;

export function watchStartup(): void {
  performance.mark("lpview:script");
  const long: PerformanceEntry[] = [];
  let observer: PerformanceObserver | null = null;
  try {
    observer = new PerformanceObserver(list => long.push(...list.getEntries()));
    observer.observe({ type: "longtask", buffered: true });
  } catch {
    // No Long Tasks API: the summary just leaves them out.
  }
  let first = false;
  let frames = 0;
  const tick = () => {
    if (frames++ === 0) performance.mark("lpview:first-frame");
    const imgs = document.querySelectorAll<HTMLImageElement>(".stage-layer:not([hidden]) img.stage-img");
    const painted = [...imgs].filter(i => i.complete && i.naturalWidth > 0);
    if (!first && painted.length > 0) {
      first = true;
      performance.mark("lpview:first-pixel");
    }
    if (painted.some(i => !i.classList.contains("thumb"))) {
      const sharp = performance.mark("lpview:first-sharp");
      const firstPixel = performance.getEntriesByName("lpview:first-pixel")[0]?.startTime ?? sharp.startTime;
      observer?.disconnect();
      const blocked = long.filter(e => e.startTime < sharp.startTime);
      const busy = blocked.map(e => `${Math.round(e.startTime)}+${Math.round(e.duration)}`).join(" ");
      const firstFrame = performance.getEntriesByName("lpview:first-frame")[0]?.startTime ?? 0;
      const summary = `first frame ${Math.round(firstFrame)} ms, first pixel ${Math.round(firstPixel)} ms, sharp ${Math.round(sharp.startTime)} ms after navigation start; long tasks: ${busy || "none"}`;
      document.documentElement.dataset.startup = summary;
      console.info(`[startup] ${summary}`);
      return;
    }
    if (performance.now() < GIVE_UP_MS) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
