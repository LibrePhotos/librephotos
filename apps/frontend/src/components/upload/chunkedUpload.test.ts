/**
 * The upload's MD5: in a worker where there is one (a stand-in here that runs the worker's own code),
 * on the page where there is none (jsdom), cancelled between slices either way.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { calculateMD5, UploadCancelledError } from "./chunkedUpload";
import { answerHashRequest, isHashRequest } from "./md5Hashing";

const ABC = "900150983cd24fb0d6963f7d28e17f72";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("calculateMD5 on the page (no worker)", () => {
  it("settles for an empty file instead of waiting forever", async () => {
    await expect(calculateMD5(new File([], "empty.jpg"))).resolves.toBe("d41d8cd98f00b204e9800998ecf8427e");
  });

  it("hashes the file contents", async () => {
    await expect(calculateMD5(new File(["abc"], "abc.txt"))).resolves.toBe(ABC);
  });

  it("stops between slices once the upload is cancelled", async () => {
    // Three 2-byte slices: the check runs after the first one and stops there.
    const isCancelled = vi.fn(() => true);
    await expect(calculateMD5(new File(["abcdef"], "big.mov"), isCancelled, 2)).rejects.toBeInstanceOf(
      UploadCancelledError
    );
    expect(isCancelled).toHaveBeenCalledTimes(1);
  });

  it("hashes slice by slice to the same result", async () => {
    await expect(calculateMD5(new File(["abc"], "abc.txt"), () => false, 2)).resolves.toBe(ABC);
  });

  it("fails as an unreadable file when a slice reads short (the file shrank)", async () => {
    const file = new File(["abcdef"], "shrinking.mov");
    // The second slice comes back empty, as a file truncated while it is read.
    vi.spyOn(file, "slice").mockImplementation(start => new Blob([start === 0 ? "ab" : ""]));
    await expect(calculateMD5(file, () => false, 2)).rejects.toThrow("Problem parsing input file.");
  });
});

/** A worker that runs the hashing worker's own handler, as the browser would in its thread. */
class FakeWorker extends EventTarget {
  static created: FakeWorker[] = [];
  static failToLoad = false;
  terminated = false;
  readonly url: string;

  constructor(
    url: URL | string,
    readonly options?: WorkerOptions
  ) {
    super();
    this.url = String(url);
    FakeWorker.created.push(this);
  }

  postMessage(data: unknown) {
    if (FakeWorker.failToLoad) {
      queueMicrotask(() => this.dispatchEvent(new Event("error", { cancelable: true })));
      return;
    }
    if (!isHashRequest(data)) throw new Error("not a hash request");
    void answerHashRequest(data, message => {
      if (!this.terminated) this.dispatchEvent(new MessageEvent("message", { data: message }));
    });
  }

  terminate() {
    this.terminated = true;
  }
}

describe("calculateMD5 in a worker", () => {
  function useFakeWorker({ failToLoad = false } = {}) {
    FakeWorker.created = [];
    FakeWorker.failToLoad = failToLoad;
    vi.stubGlobal("Worker", FakeWorker);
  }

  it("hashes in a module worker and ends it", async () => {
    useFakeWorker();
    await expect(calculateMD5(new File(["abc"], "abc.txt"), () => false, 2)).resolves.toBe(ABC);

    const [worker] = FakeWorker.created;
    expect(worker?.options?.type).toBe("module");
    expect(worker?.url).toMatch(/md5Worker/);
    expect(worker?.terminated).toBe(true);
  });

  it("ends the worker, and with it the slice it holds, once the upload is cancelled", async () => {
    useFakeWorker();
    const isCancelled = vi.fn(() => true);
    await expect(calculateMD5(new File(["abcdef"], "big.mov"), isCancelled, 2)).rejects.toBeInstanceOf(
      UploadCancelledError
    );
    expect(isCancelled).toHaveBeenCalledTimes(1);
    expect(FakeWorker.created[0]?.terminated).toBe(true);
  });

  it("reports a file it cannot read as the upload's read failure", async () => {
    useFakeWorker();
    const file = new File(["abcdef"], "shrinking.mov");
    vi.spyOn(file, "slice").mockImplementation(start => new Blob([start === 0 ? "ab" : ""]));
    await expect(calculateMD5(file, () => false, 2)).rejects.toThrow("Problem parsing input file.");
    expect(FakeWorker.created[0]?.terminated).toBe(true);
  });

  it("hashes on the page when the worker's script cannot load (a strict CSP, say)", async () => {
    useFakeWorker({ failToLoad: true });
    await expect(calculateMD5(new File(["abc"], "abc.txt"))).resolves.toBe(ABC);
    expect(FakeWorker.created[0]?.terminated).toBe(true);
  });

  it("hashes on the page when no worker can be made", async () => {
    vi.stubGlobal(
      "Worker",
      class {
        constructor() {
          throw new DOMException("blocked", "SecurityError");
        }
      }
    );
    await expect(calculateMD5(new File(["abc"], "abc.txt"))).resolves.toBe(ABC);
  });
});
