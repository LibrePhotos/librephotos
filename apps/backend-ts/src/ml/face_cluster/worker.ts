// Worker thread for the face_cluster fits (index.ts): one request, one reply.
import { FitError, runOp, type Op } from "./compute";

declare const self: Worker;

self.onmessage = (e: MessageEvent<Op>) => {
  try {
    self.postMessage({ ok: true, value: runOp(e.data) });
  } catch (err) {
    self.postMessage({ ok: false, fit: err instanceof FitError, error: (err as Error).message });
  }
};
