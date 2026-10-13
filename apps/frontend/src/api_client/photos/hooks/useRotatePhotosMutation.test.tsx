/**
 * The rotate toast read the angle sent to the server, which counts counter-clockwise turns as
 * positive, so "Rotate 90° clockwise" said "1 photo(s) rotated by -90°." (#2587). The hook now
 * takes the turn as the user sees it, sends the server its own angle, and names the direction.
 */
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../../i18n";
import type { ToastOptions } from "../../../service/notifications/toast";
import { defined } from "../../../util/defined.test-utils";
import { queryClient } from "../../api";
import { useRotatePhotosMutation } from "./useRotatePhotosMutation";

type Toast = (message: ReactNode, options?: ToastOptions) => void;

const toasts = vi.hoisted(() => ({ success: vi.fn<Toast>(), warning: vi.fn<Toast>(), error: vi.fn<Toast>() }));

vi.mock("../../../service/notifications/toast", () => ({
  toast: { success: toasts.success, warning: toasts.warning, error: toasts.error, hide: () => {} },
}));
vi.mock("../../urls", () => ({ serverAddress: "" }));

const ROTATED = { status: true, image_hash: "abc", local_orientation: 6, last_modified: "2026-10-13T10:00:00Z" };

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();
let root: ReturnType<typeof createRoot>;

beforeAll(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  toasts.success.mockReset();
  toasts.error.mockReset();
  fetchMock.mockReset();
  fetchMock.mockImplementation(() =>
    Promise.resolve(
      new Response(JSON.stringify(ROTATED), { status: 200, headers: { "Content-Type": "application/json" } })
    )
  );
  vi.stubGlobal("fetch", fetchMock);
  root = createRoot(document.createElement("div"));
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

async function rotate(clockwiseDegrees: number) {
  let mutation: ReturnType<typeof useRotatePhotosMutation> | undefined;
  function Probe() {
    mutation = useRotatePhotosMutation();
    return null;
  }
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <Probe />
      </QueryClientProvider>
    );
  });
  await act(async () => {
    await defined(mutation).mutateAsync({ image_hash: "abc", clockwiseDegrees });
  });
}

/** The body the server got. */
async function sentBody(): Promise<unknown> {
  const [input, init] = defined(fetchMock.mock.calls[0]);
  if (init?.body) return JSON.parse(String(init.body));
  const request = input instanceof Request ? input : new Request(input);
  return request.json();
}

describe("useRotatePhotosMutation", () => {
  it.each([
    [90, -90, "Photo rotated 90° clockwise."],
    [-90, 90, "Photo rotated 90° counter-clockwise."],
  ])("turns %i° clockwise: asks the server for %i° and says %s", async (clockwise, serverAngle, message) => {
    await rotate(clockwise);

    expect(await sentBody()).toEqual({ image_hash: "abc", angle: serverAngle });
    expect(toasts.success).toHaveBeenCalledTimes(1);
    expect(toasts.success.mock.calls[0]?.[0]).toBe(message);
    expect(toasts.success.mock.calls[0]?.[1]).toEqual({ title: "Rotate photo" });
  });

  it("says nothing went well when the server refuses", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response("{}", { status: 500 })));

    await expect(rotate(90)).rejects.toThrow();

    expect(toasts.success).not.toHaveBeenCalled();
  });
});
