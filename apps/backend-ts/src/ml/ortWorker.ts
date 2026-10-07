// ONNX Runtime on a worker thread. onnxruntime-node's session.run() blocks
// the calling JS thread for the whole inference (in Bun as well), so on the
// main thread one 130 ms tagger run froze every API request and the scan's
// DB/ExifTool work. ortThread.ts proxies sessions to a few of these workers.
// Built to dist/ort-worker.js (bun run build).
import type * as Ort from "onnxruntime-node";

export type WireTensor = { type: Ort.Tensor.Type; data: Ort.Tensor.DataType; dims: readonly number[] };
export type Request =
  | { op: "create"; id: number; path: string; options: Ort.InferenceSession.SessionOptions }
  | { op: "run"; id: number; sid: number; feeds: Record<string, WireTensor>; fetches?: string[] | Record<string, WireTensor> }
  | { op: "release"; id: number; sid: number };
export type Reply =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; error: string };

declare const self: Worker;

if (typeof Bun !== "undefined" && !Bun.isMainThread) {
  const ortP = import("onnxruntime-node");
  const sessions = new Map<number, Ort.InferenceSession>();
  let nextSid = 0;

  const wire = (t: Ort.Tensor): WireTensor => ({ type: t.type, data: t.data, dims: t.dims });

  self.onmessage = async (e: MessageEvent<Request>) => {
    const m = e.data;
    try {
      const ort = await ortP;
      if (m.op === "create") {
        const s = await ort.InferenceSession.create(m.path, m.options);
        const sid = ++nextSid;
        sessions.set(sid, s);
        const meta = (s as unknown as { inputMetadata?: unknown; outputMetadata?: unknown });
        self.postMessage({
          id: m.id,
          ok: true,
          value: { sid, inputNames: s.inputNames, outputNames: s.outputNames, inputMetadata: meta.inputMetadata, outputMetadata: meta.outputMetadata },
        } satisfies Reply);
      } else if (m.op === "run") {
        const s = sessions.get(m.sid);
        if (!s) throw new Error("session released");
        const feeds: Record<string, Ort.Tensor> = {};
        for (const [k, t] of Object.entries(m.feeds)) feeds[k] = new ort.Tensor(t.type, t.data as never, t.dims);
        let fetches: string[] | Record<string, Ort.Tensor> | undefined;
        if (Array.isArray(m.fetches)) fetches = m.fetches;
        else if (m.fetches) {
          fetches = {};
          for (const [k, t] of Object.entries(m.fetches)) fetches[k] = new ort.Tensor(t.type, t.data as never, t.dims);
        }
        const out = fetches ? await s.run(feeds, fetches as never) : await s.run(feeds);
        const value: Record<string, WireTensor> = {};
        // Outputs are fresh on this side: hand their buffers over instead of copying.
        const transfer = new Set<ArrayBuffer>();
        for (const [k, t] of Object.entries(out)) {
          value[k] = wire(t as Ort.Tensor);
          const b = ((t as Ort.Tensor).data as ArrayBufferView).buffer;
          if (b instanceof ArrayBuffer) transfer.add(b);
        }
        self.postMessage({ id: m.id, ok: true, value } satisfies Reply, [...transfer]);
      } else {
        await sessions.get(m.sid)?.release();
        sessions.delete(m.sid);
        self.postMessage({ id: m.id, ok: true, value: null } satisfies Reply);
      }
    } catch (err) {
      self.postMessage({ id: m.id, ok: false, error: err instanceof Error ? err.message : String(err) } satisfies Reply);
    }
  };
}
