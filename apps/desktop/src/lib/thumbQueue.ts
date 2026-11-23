export type Ticket = {
  release(): void;
  cancel(): void;
};

type Entry = { rank: () => number; start: () => void; state: "waiting" | "running" | "done" };

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

export function filmRank(i: number, current: number, firstVisible: number, lastVisible: number): number {
  const distance = Math.abs(i - current);
  return i >= firstVisible && i <= lastVisible ? distance : 100_000 + distance;
}
