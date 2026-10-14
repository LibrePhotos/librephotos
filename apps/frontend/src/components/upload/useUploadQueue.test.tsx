import { ApiError } from "@librephotos/api-client";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { defined } from "../../util/defined.test-utils";
import { useUploadQueue, type UploadQueue } from "./useUploadQueue";

const stubs = vi.hoisted(() => ({
  md5: vi.fn<(file: File, isCancelled?: () => boolean) => Promise<string>>(),
  exists: vi.fn<(url: string) => Promise<unknown>>(),
  uploadChunk: vi.fn<(opts: { form_data: FormData; offset: number; chunk_size: number }) => Promise<unknown>>(),
  uploadFinished: vi.fn<(opts: { formData: FormData; shouldInvalidate: boolean }) => Promise<unknown>>(),
  invalidate: vi.fn<() => void>(),
  patch: vi.fn<(url: string, body: unknown) => Promise<unknown>>(),
  refreshAlbums: vi.fn<(albumIds: number[]) => void>(),
}));

vi.mock("../../api_client/api", () => ({
  apiClient: { get: stubs.exists, patch: stubs.patch },
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
  useRefreshUploadAlbums: () => stubs.refreshAlbums,
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
    await tick();
  }
  expect(latest.isUploading).toBe(false);
};

const file = (name: string, bytes: number, type = "image/jpeg") => new File([new Uint8Array(bytes)], name, { type });

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(async () => {
  vi.clearAllMocks();
  stubs.md5.mockImplementation(async f => `md5-${f.name}`);
  stubs.exists.mockResolvedValue({ exists: false });
  stubs.uploadChunk.mockImplementation(async opts => ({ upload_id: "u1", offset: opts.offset + opts.chunk_size }));
  stubs.uploadFinished.mockResolvedValue({});
  stubs.patch.mockResolvedValue({ id: 12 });
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
    expect(defined(stubs.uploadChunk.mock.calls[0], "the first chunk call")[0].form_data.get("upload_id")).toBeNull();
    expect(defined(stubs.uploadChunk.mock.calls[1], "the second chunk call")[0].form_data.get("upload_id")).toBe("u1");
    expect(stubs.uploadFinished).toHaveBeenCalledTimes(1);
    const finished = defined(stubs.uploadFinished.mock.calls[0], "the finished call")[0];
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

    expect(latest.items[0]?.status).toBe("error");
    expect(latest.items[0]?.error).toBe("Network down");
    expect(stubs.invalidate).not.toHaveBeenCalled();

    await act(async () => {
      latest.retry(latest.items);
    });
    await settle();

    expect(latest.items).toHaveLength(1);
    expect(latest.items[0]?.status).toBe("done");
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

  it("fails an empty file and moves on instead of stalling the queue", async () => {
    // Uses the real hash, which used to wait forever on a 0-byte file.
    const { calculateMD5 } = await vi.importActual<typeof import("./chunkedUpload")>("./chunkedUpload");
    stubs.md5.mockImplementation(calculateMD5);

    await act(async () => {
      latest.start([file("empty.jpg", 0), file("ok.jpg", 10)]);
    });
    await settle();

    expect(latest.items.map(i => [i.file.name, i.status])).toEqual([
      ["empty.jpg", "error"],
      ["ok.jpg", "done"],
    ]);
    expect(latest.items[0]?.error).toBeTruthy();
    expect(stubs.uploadFinished).toHaveBeenCalledTimes(1);
  });
  describe("into an album (#612)", () => {
    const porto = { id: 12, title: "Porto 2025" };
    const finishedForm = (call: number) =>
      defined(stubs.uploadFinished.mock.calls[call], `finished call ${call}`)[0].formData;
    const refusal = (code: string) =>
      new ApiError(400, "/upload/complete/", "refused", { errors: [{ field: "album_id", message: "no", code }] });

    it("sends the album with each file and refreshes the album once", async () => {
      await act(async () => {
        latest.start([file("a.jpg", 10), file("b.jpg", 10)], porto);
      });
      await settle();

      expect(latest.items.map(i => [i.status, i.album, i.albumOutcome])).toEqual([
        ["done", porto, undefined],
        ["done", porto, undefined],
      ]);
      expect(finishedForm(0).get("album_id")).toBe("12");
      expect(finishedForm(1).get("album_id")).toBe("12");
      expect(stubs.refreshAlbums).toHaveBeenCalledExactlyOnceWith([12]);
      expect(stubs.invalidate).toHaveBeenCalledTimes(1);
    });

    it("sends no album for an upload into the library", async () => {
      await act(async () => {
        latest.start([file("a.jpg", 10)]);
      });
      await settle();

      expect(finishedForm(0).get("album_id")).toBeNull();
      expect(stubs.refreshAlbums).toHaveBeenCalledExactlyOnceWith([]);
    });

    it("adds the files the library already had to the album, in one request", async () => {
      stubs.exists.mockImplementation(async url => ({ exists: true, photo_id: url.includes("one") ? "p1" : "p2" }));
      await act(async () => {
        latest.start([file("one.jpg", 10), file("two.jpg", 10)], porto);
      });
      await settle();

      expect(stubs.uploadFinished).not.toHaveBeenCalled();
      expect(stubs.patch).toHaveBeenCalledExactlyOnceWith("/albums/user/edit/12/", {
        photos: ["p1", "p2"],
      });
      expect(latest.items.map(i => [i.status, i.albumOutcome])).toEqual([
        ["duplicate", "added_existing"],
        ["duplicate", "added_existing"],
      ]);
      expect(stubs.refreshAlbums).toHaveBeenCalledExactlyOnceWith([12]);
      expect(stubs.invalidate).not.toHaveBeenCalled();
    });

    it("leaves a known file in the library when the album will not take it", async () => {
      stubs.exists.mockResolvedValue({ exists: true, photo_id: "p1" });
      stubs.patch.mockRejectedValue(refusal("locked"));
      await act(async () => {
        latest.start([file("one.jpg", 10)], porto);
      });
      await settle();

      expect(latest.items[0]?.albumOutcome).toBe("library_only");
      expect(stubs.refreshAlbums).toHaveBeenCalledExactlyOnceWith([]);
    });

    it("cannot file a known file from a server that sends no photo id", async () => {
      stubs.exists.mockResolvedValue({ exists: true });
      await act(async () => {
        latest.start([file("one.jpg", 10)], porto);
      });
      await settle();

      expect(stubs.patch).not.toHaveBeenCalled();
      expect(latest.items[0]?.albumOutcome).toBeUndefined();
    });

    it.each(["album_locked", "album_not_found"])(
      "completes the same upload into the library when the server answers %s",
      async code => {
        stubs.uploadFinished.mockRejectedValueOnce(refusal(code));
        await act(async () => {
          latest.start([file("a.jpg", 10)], porto);
        });
        await settle();

        expect(stubs.uploadFinished).toHaveBeenCalledTimes(2);
        expect(finishedForm(0).get("album_id")).toBe("12");
        expect(finishedForm(1).get("album_id")).toBeNull();
        expect(finishedForm(1).get("upload_id")).toBe(finishedForm(0).get("upload_id"));
        expect(latest.items[0]).toMatchObject({ status: "done", albumOutcome: "library_only" });
        expect(stubs.refreshAlbums).toHaveBeenCalledExactlyOnceWith([]);
        expect(stubs.invalidate).toHaveBeenCalledTimes(1);
      }
    );

    it("fails the file on any other refusal", async () => {
      stubs.uploadFinished.mockRejectedValueOnce(refusal("invalid"));
      await act(async () => {
        latest.start([file("a.jpg", 10)], porto);
      });
      await settle();

      expect(stubs.uploadFinished).toHaveBeenCalledTimes(1);
      expect(latest.items[0]?.status).toBe("error");
    });

    it("keeps the album when a failed file is retried", async () => {
      stubs.uploadChunk.mockRejectedValueOnce(new Error("Network down"));
      await act(async () => {
        latest.start([file("a.jpg", 10)], porto);
      });
      await settle();
      await act(async () => {
        latest.retry(latest.items);
      });
      await settle();

      expect(latest.items[0]).toMatchObject({ status: "done", album: porto });
      expect(finishedForm(0).get("album_id")).toBe("12");
    });
  });

  describe("cancel", () => {
    /** The next chunk call waits until the returned release() is called. */
    const holdNextChunk = () => {
      let release = () => {};
      stubs.uploadChunk.mockImplementationOnce(
        opts =>
          new Promise(resolve => {
            release = () => resolve({ upload_id: "u1", offset: opts.offset + opts.chunk_size });
          })
      );
      return () => release();
    };

    it("stops after the chunk in flight and marks every unfinished file cancelled", async () => {
      const release = holdNextChunk();
      await act(async () => {
        latest.start([file("a.jpg", 2_500_000), file("b.jpg", 10), file("c.jpg", 10)]);
      });
      await tick();
      expect(latest.items.map(i => i.status)).toEqual(["uploading", "pending", "pending"]);

      await act(async () => {
        latest.cancel();
      });
      expect(latest.isCancelling).toBe(true);
      expect(latest.isUploading).toBe(true);
      expect(latest.items.map(i => i.status)).toEqual(["uploading", "cancelled", "cancelled"]);

      await act(async () => {
        release();
      });
      await settle();

      expect(latest.items.map(i => i.status)).toEqual(["cancelled", "cancelled", "cancelled"]);
      expect(latest.isCancelling).toBe(false);
      expect(stubs.uploadChunk).toHaveBeenCalledTimes(1);
      expect(stubs.uploadFinished).not.toHaveBeenCalled();
      expect(stubs.invalidate).not.toHaveBeenCalled();
    });

    it("keeps finished files and still invalidates once", async () => {
      await act(async () => {
        latest.start([file("done.jpg", 10)]);
      });
      await settle();
      const release = holdNextChunk();
      await act(async () => {
        latest.start([file("slow.jpg", 10), file("waiting.jpg", 10)]);
      });
      await tick();

      await act(async () => {
        latest.cancel();
        release();
      });
      await settle();

      expect(latest.items.map(i => i.status)).toEqual(["done", "cancelled", "cancelled"]);
      expect(stubs.invalidate).toHaveBeenCalledTimes(1);
    });

    it("skips /upload/complete/ when cancelled after the last chunk", async () => {
      const release = holdNextChunk();
      await act(async () => {
        latest.start([file("one-chunk.jpg", 10)]);
      });
      await tick();
      await act(async () => {
        latest.cancel();
        release();
      });
      await settle();

      expect(latest.items[0]?.status).toBe("cancelled");
      expect(stubs.uploadFinished).not.toHaveBeenCalled();
    });

    it("passes the cancel check to the hash and treats a failure after cancel as cancelled", async () => {
      let isCancelled = () => false;
      let fail = (_err: Error) => {};
      stubs.md5.mockImplementationOnce(
        (_f, check) =>
          new Promise((_resolve, reject) => {
            isCancelled = check ?? isCancelled;
            fail = reject;
          })
      );
      await act(async () => {
        latest.start([file("hashing.mov", 10)]);
      });
      await tick();
      expect(isCancelled()).toBe(false);

      await act(async () => {
        latest.cancel();
      });
      expect(isCancelled()).toBe(true);
      await act(async () => {
        fail(new Error("aborted"));
      });
      await settle();

      expect(latest.items[0]?.status).toBe("cancelled");
      expect(latest.items[0]?.error).toBeUndefined();
    });

    it("uploads files added after cancel, and retry re-queues the cancelled ones", async () => {
      const release = holdNextChunk();
      await act(async () => {
        latest.start([file("first.jpg", 10), file("second.jpg", 10)]);
      });
      await tick();
      await act(async () => {
        latest.cancel();
        latest.start([file("later.jpg", 10)]);
      });
      await act(async () => {
        release();
      });
      await settle();

      expect(latest.items.map(i => [i.file.name, i.status])).toEqual([
        ["first.jpg", "cancelled"],
        ["second.jpg", "cancelled"],
        ["later.jpg", "done"],
      ]);

      await act(async () => {
        latest.retry(latest.items);
      });
      await settle();

      expect(latest.items.map(i => i.status)).toEqual(["done", "done", "done"]);
      expect(stubs.uploadFinished).toHaveBeenCalledTimes(3);
    });

    it("does nothing while the queue is idle", async () => {
      await act(async () => {
        latest.start([file("ok.jpg", 10)]);
      });
      await settle();
      await act(async () => {
        latest.cancel();
      });

      expect(latest.items[0]?.status).toBe("done");
      expect(latest.isCancelling).toBe(false);
    });
  });
});
