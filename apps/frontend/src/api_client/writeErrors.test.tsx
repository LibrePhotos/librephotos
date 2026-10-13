/**
 * Naming a face, drawing one and rotating a photo are saved in LibrePhotos even when ExifTool
 * cannot write them to the file or sidecar (a read-only library, a HEIC or RAW original). The
 * server says so in `write_error` (#2294), and the web app dropped it: the user only saw the green
 * "done" toast and believed the edit was in the file (#2564). Such a response now adds a warning.
 */
import { MutationObserver, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import type { ToastOptions } from "../service/notifications/toast";
import { defined } from "../util/defined.test-utils";
import { queryClient } from "./api";
import { useAddFaceMutation } from "./faces/hooks/useAddFaceMutation";
import { useSetFacesPersonLabelMutation } from "./faces/hooks/useSetFacesPersonLabelMutation";
import { useRotatePhotosMutation } from "./photos/hooks/useRotatePhotosMutation";

type Toast = (message: ReactNode, options?: ToastOptions) => void;

const toasts = vi.hoisted(() => ({ success: vi.fn<Toast>(), warning: vi.fn<Toast>(), error: vi.fn<Toast>() }));

vi.mock("../service/notifications/toast", () => ({
  toast: { success: toasts.success, warning: toasts.warning, error: toasts.error, hide: () => {} },
}));
vi.mock("./urls", () => ({ serverAddress: "" }));

const REASON = "the folder /photos/2024 is read-only";

/** The server's answer to every request: a JSON body with this status. */
function answer(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }))
    )
  );
}

let root: ReturnType<typeof createRoot>;

beforeAll(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  toasts.success.mockReset();
  toasts.warning.mockReset();
  toasts.error.mockReset();
  root = createRoot(document.createElement("div"));
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

/** Let the request and the mutation's callbacks run. */
async function settle() {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await new Promise(resolve => {
        setTimeout(resolve, 0);
      });
    });
  }
}

/** Render a hook, run `start` on it once, and let it settle. */
async function run<R>(useHook: () => R, start: (result: R) => void) {
  let latest: R | undefined;
  function Probe() {
    latest = useHook();
    return null;
  }
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <Probe />
      </QueryClientProvider>
    );
  });
  act(() => start(defined(latest)));
  await settle();
}

const notWritten = () => i18n.t("toasts.notwrittentofile", { reason: REASON });

const face = { id: 3, person: 7, person_name: "Alice" };
const labelled = (writeError: string | null) => ({
  status: true,
  results: [face],
  updated: [face],
  not_updated: [],
  write_error: writeError,
});
const added = (writeError: string | null) => ({
  status: true,
  write_error: writeError,
  face: {
    face_id: 9,
    face_url: "/media/faces/9.jpg",
    person: 7,
    person_name: "Alice",
    location: { top: 1, right: 2, bottom: 3, left: 0 },
  },
});
const rotated = (writeError: string | null) => ({
  status: true,
  image_hash: "abc",
  local_orientation: 6,
  last_modified: "2026-10-13T10:00:00Z",
  write_error: writeError,
});

const label = () =>
  run(useSetFacesPersonLabelMutation, mutation => mutation.mutate({ faceIds: [3], personName: "Alice" }));
const draw = () =>
  run(useAddFaceMutation, mutation =>
    mutation.mutate({ photo: "abc", personName: "Alice", box: { top: 0.1, right: 0.5, bottom: 0.5, left: 0.1 } })
  );
const rotate = () => run(useRotatePhotosMutation, mutation => mutation.mutate({ image_hash: "abc", angle: 90 }));

describe("an edit saved in LibrePhotos but not written to the file", () => {
  it.each([
    ["naming faces", labelled, label],
    ["drawing a face", added, draw],
    ["rotating a photo", rotated, rotate],
  ] as const)("%s says it was not written, and why", async (_name, body, edit) => {
    answer(200, body(REASON));
    await edit();

    expect(toasts.warning).toHaveBeenCalledTimes(1);
    expect(toasts.warning.mock.calls[0]?.[0]).toBe(notWritten());
    // The edit itself did save, so the "done" toast stays.
    expect(toasts.success).toHaveBeenCalledTimes(1);
    expect(toasts.error).not.toHaveBeenCalled();
  });

  it.each([
    ["naming faces", labelled, label],
    ["drawing a face", added, draw],
    ["rotating a photo", rotated, rotate],
  ] as const)("%s warns about nothing when the file was written", async (_name, body, edit) => {
    answer(200, body(null));
    await edit();

    expect(toasts.warning).not.toHaveBeenCalled();
    expect(toasts.success).toHaveBeenCalledTimes(1);
  });

  it("warns about nothing when an older server sends no write_error", async () => {
    answer(200, { status: true, image_hash: "abc", local_orientation: 6, last_modified: "2026-10-13T10:00:00Z" });
    await rotate();

    expect(toasts.warning).not.toHaveBeenCalled();
    expect(toasts.success).toHaveBeenCalledTimes(1);
  });
});

describe("a response without a reason to show", () => {
  it.each([[""], [42], [{ detail: "x" }]])("warns about nothing for write_error %j", async writeError => {
    const observer = new MutationObserver(queryClient, {
      mutationFn: () => Promise.resolve({ status: true, write_error: writeError }),
    });
    await observer.mutate();

    expect(toasts.warning).not.toHaveBeenCalled();
  });
});
