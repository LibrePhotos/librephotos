import { describe, expect, it } from "vitest";
import { uploadItem } from "./uploadItem.test-utils";
import { EMPTY_QUEUE, nextPending, reduceQueue, type QueueEvent, type QueueState } from "./uploadQueueState";

const queue = (run: QueueState["run"], ...items: QueueState["items"]): QueueState => ({ run, items });
const apply = (state: QueueState, ...events: QueueEvent[]) => events.reduce(reduceQueue, state);

describe("reduceQueue", () => {
  it("runs idle, uploading, cancelling and back, and cancelling only from a running queue", () => {
    expect(apply(EMPTY_QUEUE, { type: "cancel" })).toBe(EMPTY_QUEUE);
    expect(apply(EMPTY_QUEUE, { type: "fileEnded" })).toBe(EMPTY_QUEUE);

    const running = apply(EMPTY_QUEUE, { type: "runStarted" });
    expect(running.run).toBe("uploading");
    const cancelling = apply(running, { type: "cancel" });
    expect(cancelling.run).toBe("cancelling");
    expect(apply(cancelling, { type: "fileEnded" }).run).toBe("uploading");
    expect(apply(cancelling, { type: "runEnded" }).run).toBe("idle");
  });

  it("cancels the waiting files and leaves the one in flight to end by itself", () => {
    const state = apply(
      queue("uploading", uploadItem("a", "uploading", { progress: 40 }), uploadItem("b", "pending")),
      { type: "cancel" }
    );

    expect(state.items.map(item => item.status)).toEqual(["uploading", "cancelled"]);
    expect(nextPending(state)).toBeUndefined();
  });

  it("re-queues only a failed or cancelled file, so a second retry changes nothing", () => {
    const failed = queue("idle", uploadItem("a", "error", { error: "Boom" }), uploadItem("b", "done"));
    const once = apply(failed, { type: "retried", ids: ["a", "b"] });

    expect(once.items.map(item => item.status)).toEqual(["pending", "done"]);
    expect(apply(once, { type: "retried", ids: ["a", "b"] })).toBe(once);
  });

  it("keeps a finished file's import job only on the finished file", () => {
    const state = apply(
      queue("uploading", uploadItem("a", "pending")),
      { type: "hashing", id: "a" },
      { type: "uploading", id: "a" },
      { type: "progress", id: "a", progress: 50 },
      { type: "finished", id: "a", result: { status: "done", jobId: "j1", photoId: "p1" } }
    );
    expect(state.items[0]).toMatchObject({ status: "done", jobId: "j1", photoId: "p1", progress: 100 });

    const again = apply(state, { type: "stopped", id: "a", result: { status: "error", error: "late" } });
    expect(again).toBe(state);
  });

  it("clears the list only while idle", () => {
    const running = queue("uploading", uploadItem("a", "uploading"));
    expect(apply(running, { type: "reset" })).toBe(running);
    expect(apply(queue("idle", uploadItem("a", "done")), { type: "reset" })).toBe(EMPTY_QUEUE);
  });
});
