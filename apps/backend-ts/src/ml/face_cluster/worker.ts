// Worker thread for the face_cluster fits (index.ts): one request, one reply.
// Only ever loaded as a worker (it installs self.onmessage).
// /train fits its known-faces classifier on a second worker meanwhile.
import { FitError, runOp, type Fit, type Op } from "./compute";
import { Mlp, type MlpParams } from "./mlp";

declare const self: Worker;

type Reply = { ok: boolean; value?: unknown; fit?: boolean; error?: string };

/** `m` on a fresh worker of this file. */
function onWorker(url: string, m: Op): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const w = new Worker(url);
    w.onmessage = (e: MessageEvent<Reply>) => {
      w.terminate();
      if (e.data.ok) resolve(e.data.value);
      else reject(e.data.fit ? new FitError(e.data.error) : new Error(e.data.error));
    };
    w.onerror = (e) => {
      w.terminate();
      reject(new Error(`face_cluster worker: ${e.message}`));
    };
    w.postMessage(m);
  });
}

const fitOnWorker: Fit = async (x, y) => Mlp.fromParams((await onWorker(import.meta.url, { op: "fit", req: { x, y } })) as MlpParams);

self.onmessage = async (e: MessageEvent<Op>) => {
  try {
    self.postMessage({ ok: true, value: await runOp(e.data, fitOnWorker) } satisfies Reply);
  } catch (err) {
    self.postMessage({ ok: false, fit: err instanceof FitError, error: (err as Error).message } satisfies Reply);
  }
};
