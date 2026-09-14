import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useUploadQueue, type UploadQueue } from "./useUploadQueue";

const stubs = vi.hoisted(() => ({
  md5: vi.fn<(file: File) => Promise<string>>(),
  exists: vi.fn<(url: string) => Promise<unknown>>(),
  uploadChunk: vi.fn<(opts: { form_data: FormData; offset: number; chunk_size: number }) => Promise<unknown>>(),
  uploadFinished: vi.fn<(opts: { formData: FormData; shouldInvalidate: boolean }) => Promise<unknown>>(),
  invalidate: vi.fn(),
}));

vi.mock("../../api_client/api", () => ({
  fetchClient: { get: stubs.exists },
  queryClient: { invalidateQueries: () => {} },
}));
vi.mock("../../api_client/user/hooks/useCurrentUserSelfDetailsQuery", () => ({
  useCurrentUserSelfDetailsQuery: () => ({ data: { id: 7, scan_directory: "/data" } }),
}));
vi.mock("../../api_client/upload", async importOriginal => ({
  ...(await importOriginal<typeof import("../../api_client/upload")>()),
  useUploadMutation: () => ({ mutateAsync: stubs.uploadChunk }),
  useUploadFinishedMutation: () => ({ mutateAsync: stubs.uploadFinished }),
  invalidateUploadQueries: stubs.invalidate,
}));
vi.mock("../../util/zodUtils", () => ({
  parseWithNotification: (schema: { parse: (v: unknown) => unknown }, value: unknown) => schema.parse(value),
}));
vi.mock("./chunkedUpload", async importOriginal => ({
  ...(await importOriginal<typeof import("./chunkedUpload")>()),
  calculateMD5: stubs.md5,
}));

let latest: UploadQueue;
function Harness() {
  latest = useUploadQueue();
  return null;
}

let root: Root;
let container: HTMLDivElement;

const tick = () => act(() => new Promise<void>(resolve => setTimeout(resolve, 0)));
const settle = async () => {
  for (let i = 0; i < 50 && latest.isUploading; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await tick();
  }
  expect(latest.isUploading).toBe(false);
};

const file = (name: string, bytes: number, type = "image/jpeg") => new File([new Uint8Array(bytes)], name, { type });

beforeAll(() => {
  // @ts-ignore
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(async () => {
  vi.clearAllMocks();
  stubs.md5.mockImplementation(async f => `md5-${f.name}`);
  stubs.exists.mockResolvedValue({ exists: false });
  stubs.uploadChunk.mockImplementation(async opts => ({ upload_id: "u1", offset: opts.offset + opts.chunk_size }));
  stubs.uploadFinished.mockResolvedValue({});
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<Harness />);
  });
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

describe("useUploadQueue", () => {
  it("uploads new files in chunks, marks known files as duplicates and invalidates once at the end", async () => {
    stubs.exists.mockImplementation(async url => ({ exists: url.endsWith("md5-dup.jpg7") }));
    const fresh = file("fresh.jpg", 1_500_000);
    const dup = file("dup.jpg", 10);

    await act(async () => {
      latest.start([fresh, dup]);
    });
    await settle();

    expect(latest.items.map(i => [i.file.name, i.status, i.progress])).toEqual([
      ["fresh.jpg", "done", 100],
      ["dup.jpg", "duplicate", 100],
    ]);
    expect(stubs.uploadChunk).toHaveBeenCalledTimes(2);
    expect(stubs.uploadChunk.mock.calls[0][0].form_data.get("upload_id")).toBeNull();
    expect(stubs.uploadChunk.mock.calls[1][0].form_data.get("upload_id")).toBe("u1");
    expect(stubs.uploadFinished).toHaveBeenCalledTimes(1);
    const finished = stubs.uploadFinished.mock.calls[0][0];
    expect(finished.shouldInvalidate).toBe(false);
    expect(finished.formData.get("md5")).toBe("md5-fresh.jpg");
    expect(finished.formData.get("filename")).toBe("fresh.jpg");
    expect(finished.formData.get("user")).toBe("7");
    expect(stubs.invalidate).toHaveBeenCalledTimes(1);
  });

  it("keeps the error on the failed item and lets it be retried", async () => {
    stubs.uploadChunk.mockRejectedValueOnce(new Error("Network down"));

    await act(async () => {
      latest.start([file("broken.jpg", 10)]);
    });
    await settle();

    expect(latest.items[0].status).toBe("error");
    expect(latest.items[0].error).toBe("Network down");
    expect(stubs.invalidate).not.toHaveBeenCalled();

    await act(async () => {
      latest.retry(latest.items);
    });
    await settle();

    expect(latest.items).toHaveLength(1);
    expect(latest.items[0].status).toBe("done");
    expect(stubs.invalidate).toHaveBeenCalledTimes(1);
  });

  it("ignores retry for items that did not fail", async () => {
    await act(async () => {
      latest.start([file("ok.jpg", 10)]);
    });
    await settle();
    expect(stubs.uploadFinished).toHaveBeenCalledTimes(1);

    await act(async () => {
      latest.retry(latest.items);
    });
    await settle();
    expect(stubs.uploadFinished).toHaveBeenCalledTimes(1);
  });

  it("queues files added while an upload is running instead of uploading in parallel", async () => {
    let releaseFirst = () => {};
    stubs.uploadChunk.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          releaseFirst = () => resolve({ upload_id: "u1", offset: 10 });
        })
    );

    await act(async () => {
      latest.start([file("first.jpg", 10)]);
    });
    await tick();
    await act(async () => {
      latest.start([file("second.jpg", 10)]);
    });
    await tick();

    expect(latest.items.map(i => i.status)).toEqual(["uploading", "pending"]);
    expect(stubs.uploadChunk).toHaveBeenCalledTimes(1);

    await act(async () => {
      releaseFirst();
    });
    await settle();

    expect(latest.items.map(i => i.status)).toEqual(["done", "done"]);
    expect(stubs.invalidate).toHaveBeenCalledTimes(1);
  });

  it("only clears the list once the queue is idle", async () => {
    let releaseFirst = () => {};
    stubs.uploadChunk.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          releaseFirst = () => resolve({ upload_id: "u1", offset: 10 });
        })
    );

    await act(async () => {
      latest.start([file("slow.jpg", 10)]);
    });
    await tick();
    await act(async () => {
      latest.reset();
    });
    expect(latest.items).toHaveLength(1);

    await act(async () => {
      releaseFirst();
    });
    await settle();
    await act(async () => {
      latest.reset();
    });
    expect(latest.items).toHaveLength(0);
  });
});
