/** One of the user's own albums an upload files into (#612). */
export type UploadAlbumTarget = { id: number; title: string };

/**
 * How filing into the album came out, where it differs from "uploaded into it": a file the library
 * already had was added to it, or the album refused the file (locked or deleted meanwhile), which
 * went to the library only.
 */
export type AlbumOutcome = "added_existing" | "library_only";

/** What a finished file carries: the import job and photo only a new upload has (#2737). */
export type Finished =
  | { status: "done"; albumOutcome?: AlbumOutcome; jobId?: string; photoId?: string }
  | { status: "duplicate"; albumOutcome?: AlbumOutcome; photoId?: string };

/** How a file stopped before it finished. */
type Stopped = { status: "error"; error: string } | { status: "cancelled" };

/** Where one file stands; the data of a state is there only in that state. */
type ItemState = { status: "pending" } | { status: "hashing" } | { status: "uploading" } | Finished | Stopped;

export type UploadItem = {
  id: string;
  file: File;
  /** The album the file goes into; none for the library alone. */
  album?: UploadAlbumTarget;
  /** 0..100, bytes of this file sent so far */
  progress: number;
} & ItemState;

export type UploadStatus = UploadItem["status"];

/**
 * The queue's worker: `uploading` while it works through the waiting files, `cancelling` from
 * cancel() until the file in flight ends (its current chunk or hash slice).
 */
export type QueueRun = "idle" | "uploading" | "cancelling";

export type QueueState = { items: UploadItem[]; run: QueueRun };

export type QueueEvent =
  | { type: "added"; items: UploadItem[] }
  | { type: "runStarted" }
  | { type: "hashing"; id: string }
  | { type: "uploading"; id: string }
  | { type: "progress"; id: string; progress: number }
  | { type: "finished"; id: string; result: Finished }
  | { type: "stopped"; id: string; result: Stopped }
  | { type: "filed"; outcomes: { itemId: string; outcome: AlbumOutcome }[] }
  | { type: "retried"; ids: readonly string[] }
  | { type: "cancel" }
  | { type: "fileEnded" }
  | { type: "runEnded" }
  | { type: "reset" };

/** The events that move single files. */
type ItemEvent = Extract<
  QueueEvent,
  { type: "hashing" | "uploading" | "progress" | "finished" | "stopped" | "retried" | "cancel" }
>;

export const EMPTY_QUEUE: QueueState = { items: [], run: "idle" };

const base = ({ id, file, album, progress }: UploadItem) => ({ id, file, album, progress });

const inFlight = (item: UploadItem) => item.status === "hashing" || item.status === "uploading";

/** The item after `event`, or the same item when the event does not apply to its state. */
function moveItem(item: UploadItem, event: ItemEvent): UploadItem {
  switch (event.type) {
    case "hashing":
      return item.status === "pending" ? { ...base(item), status: "hashing", progress: 0 } : item;
    case "uploading":
      return item.status === "hashing" ? { ...base(item), status: "uploading", progress: 0 } : item;
    case "progress":
      return item.status === "uploading" ? { ...item, progress: event.progress } : item;
    case "finished":
      return inFlight(item) ? { ...base(item), ...event.result, progress: 100 } : item;
    case "stopped": {
      if (item.status !== "pending" && !inFlight(item)) return item;
      return event.result.status === "cancelled"
        ? { ...base(item), status: "cancelled", progress: 0 }
        : { ...base(item), ...event.result };
    }
    case "retried":
      return item.status === "error" || item.status === "cancelled"
        ? { ...base(item), status: "pending", progress: 0 }
        : item;
    case "cancel":
      return item.status === "pending" ? { ...base(item), status: "cancelled", progress: 0 } : item;
  }
}

function moveItems(state: QueueState, event: ItemEvent): QueueState {
  const id = "id" in event ? event.id : undefined;
  const ids = event.type === "retried" ? new Set(event.ids) : null;
  let changed = false;
  const items = state.items.map(item => {
    if ((id !== undefined && item.id !== id) || (ids && !ids.has(item.id))) return item;
    const moved = moveItem(item, event);
    changed = changed || moved !== item;
    return moved;
  });
  return changed ? { ...state, items } : state;
}

function fileInto(state: QueueState, outcomes: { itemId: string; outcome: AlbumOutcome }[]): QueueState {
  const byItem = new Map(outcomes.map(({ itemId, outcome }) => [itemId, outcome]));
  const items = state.items.map(item => {
    const albumOutcome = byItem.get(item.id);
    if (!albumOutcome || (item.status !== "done" && item.status !== "duplicate")) return item;
    return { ...item, albumOutcome };
  });
  return { ...state, items };
}

/**
 * The upload queue's one transition function. Every item event applies only to the states it
 * leaves (a retry re-queues only a failed or cancelled file, so a second retry is a no-op), and
 * the run moves idle → uploading ⇄ cancelling → idle.
 */
export function reduceQueue(state: QueueState, event: QueueEvent): QueueState {
  switch (event.type) {
    case "added":
      return { ...state, items: [...state.items, ...event.items] };
    case "runStarted":
      return state.run === "idle" ? { ...state, run: "uploading" } : state;
    case "cancel":
      return state.run === "uploading" ? { ...moveItems(state, event), run: "cancelling" } : state;
    case "fileEnded":
      return state.run === "cancelling" ? { ...state, run: "uploading" } : state;
    case "runEnded":
      return state.run === "idle" ? state : { ...state, run: "idle" };
    case "reset":
      return state.run === "idle" && state.items.length > 0 ? EMPTY_QUEUE : state;
    case "filed":
      return fileInto(state, event.outcomes);
    case "hashing":
    case "uploading":
    case "progress":
    case "finished":
    case "stopped":
    case "retried":
      return moveItems(state, event);
  }
}

/** The next file the worker takes: the oldest still waiting. */
export const nextPending = (state: QueueState): UploadItem | undefined =>
  state.items.find(item => item.status === "pending");

/** How filing into the album came out, for a finished file. */
export const albumOutcomeOf = (item: UploadItem): AlbumOutcome | undefined =>
  item.status === "done" || item.status === "duplicate" ? item.albumOutcome : undefined;
