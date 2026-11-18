/**
 * Hands out filmstrip thumb loads a few at a time, best rank first.
 *
 * The webview sends every `<img>` request to Rust at once and in DOM order, so without this the
 * pipeline (LIFO) would start with the last off-screen item. Here items register a rank (lower is
 * sooner: visible items centre-out, then the overscan) and get their turn when a slot frees up.
 * Ranks are read when a slot is handed out, so scrolling re-orders whatever is still waiting.
 */
export type Ticket = {
  /** The load finished (or failed): free the slot. */
  release(): void;
  /** The item went away: drop it from the queue or free its slot. */
  cancel(): void;
};

type Entry = { rank: () => number; start: () => void; state: "waiting" | "running" | "done" };

/** Concurrent loads: one more than the pipeline's thumb workers, so none of them idles. */
const MAX_RUNNING = 6;

const waiting = new Set<Entry>();
let running = 0;
let pumpQueued = false;

function pump(): void {
  pumpQueued = false;
  while (running < MAX_RUNNING && waiting.size > 0) {
    let best: Entry | null = null;
    let bestRank = Infinity;
    for (const e of waiting) {
      const r = e.rank();
      if (r < bestRank) {
        best = e;
        bestRank = r;
      }
    }
    if (!best) return;
    waiting.delete(best);
    best.state = "running";
    running += 1;
    best.start();
  }
}

/** Runs after the current batch of mounts, so a whole render is ranked together. */
function schedulePump(): void {
  if (pumpQueued) return;
  pumpQueued = true;
  queueMicrotask(pump);
}

export function enqueueThumb(rank: () => number, start: () => void): Ticket {
  const entry: Entry = { rank, start, state: "waiting" };
  waiting.add(entry);
  schedulePump();
  const finish = () => {
    if (entry.state === "waiting") waiting.delete(entry);
    else if (entry.state === "running") {
      running -= 1;
      schedulePump();
    }
    entry.state = "done";
  };
  return { release: finish, cancel: finish };
}

/** Rank of filmstrip item `i`: visible items by distance from the current one, then the rest. */
export function filmRank(i: number, current: number, firstVisible: number, lastVisible: number): number {
  const distance = Math.abs(i - current);
  return i >= firstVisible && i <= lastVisible ? distance : 100_000 + distance;
}
