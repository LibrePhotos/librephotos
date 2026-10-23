/**
 * The face dashboard and the lightbox said "faces deleted" or "removed from person" right after
 * sending the request, before the server answered, so a failed delete still claimed it worked;
 * the delete hook only logged a failure to the console (#2222). The success toasts now come from
 * the hooks once the server confirmed, and a failure is reported instead.
 */
import { MantineProvider } from "@mantine/core";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PersonDetail } from "../../../components/lightbox/PersonDetailComponent";
import i18n from "../../../i18n";
import type { ToastOptions } from "../../../service/notifications/toast";
import { defined } from "../../../util/defined.test-utils";
import { queryClient } from "../../api";
import { useDeleteFacesMutation } from "./useDeleteFacesMutation";
import { useSetFacesPersonLabelMutation } from "./useSetFacesPersonLabelMutation";

type Toast = (message: ReactNode, options?: ToastOptions & { undo?: () => Promise<unknown> }) => void;

const toasts = vi.hoisted(() => ({ success: vi.fn<Toast>(), error: vi.fn<Toast>() }));

vi.mock("../../../service/notifications/toast", () => ({
  toast: {
    success: toasts.success,
    // The face toasts add up while on screen (#599); here each one is a plain success toast
    successCounted: (
      _id: string,
      count: number,
      message: (total: number, extra: number) => ReactNode,
      options?: ToastOptions & { undo?: () => Promise<unknown>; extra?: number }
    ) => toasts.success(message(count, options?.extra ?? 0), options),
    error: toasts.error,
    warning: () => {},
    hide: () => {},
  },
}));
vi.mock("../../urls", () => ({ serverAddress: "" }));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => () => {},
  getRouteApi: () => ({ useSearch: () => ({ tab: "inferred" }) }),
}));

/** The server's answer to every request: a JSON body with this status. */
function answer(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }))
    )
  );
}

/** Never answers: what the user sees between the click and the server's reply. */
function hang() {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise<Response>(() => {}))
  );
}

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;

beforeAll(async () => {
  // jsdom has no matchMedia, MantineProvider needs it
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  toasts.success.mockReset();
  toasts.error.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
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

const titles = () => toasts.success.mock.calls.map(call => call[1]?.title);

describe("deleting faces", () => {
  it("says the faces were deleted only once the server confirmed it", async () => {
    answer(200, { status: true, results: [], deleted: ["1", "2"], not_deleted: [] });
    await run(useDeleteFacesMutation, mutation => mutation.mutate({ faceIds: [1, 2] }));

    expect(titles()).toEqual([i18n.t("toasts.deletefacestitle")]);
  });

  it("reports a failed delete instead of claiming it worked", async () => {
    answer(403, { detail: "You do not own these faces." });
    await run(useDeleteFacesMutation, mutation => mutation.mutate({ faceIds: [1] }));

    expect(toasts.success).not.toHaveBeenCalled();
    expect(toasts.error.mock.calls[0]?.[0]).toBe("You do not own these faces.");
  });

  it("shows nothing from the lightbox's delete button while the server has not answered", async () => {
    hang();
    const person = {
      name: "Alice",
      type: "classification",
      probability: 0.8,
      location: { top: 10, bottom: 100, left: 20, right: 90 },
      face_url: "/faces/1.jpg",
      face_id: 2,
    };
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <MantineProvider env="test">
            <PersonDetail
              person={person}
              isPublic={false}
              setFaceLocation={() => {}}
              onPersonEdit={() => {}}
              notThisPerson={() => {}}
            />
          </MantineProvider>
        </QueryClientProvider>
      );
    });
    const buttons = container.querySelectorAll("button");
    await act(async () => defined(buttons[buttons.length - 1]).click());
    await settle();

    expect(toasts.success).not.toHaveBeenCalled();
  });
});

describe("moving faces back to unknown", () => {
  it("says they were removed from the person, once, after the server confirmed", async () => {
    answer(200, { status: true, results: [{ id: 3, person_name: "Unknown - Other", person: null }] });
    await run(useSetFacesPersonLabelMutation, mutation =>
      mutation.mutate({ faceIds: [3], personName: "Unknown - Other" })
    );

    expect(titles()).toEqual([i18n.t("toasts.removefacestopersontitle")]);
  });

  it("names who will not be suggested for the face again (#2747)", async () => {
    answer(200, {
      status: true,
      results: [{ id: 3, person_name: "Unknown - Other", person: null }],
      rejected_people: [{ id: 5, name: "Anna" }],
    });
    await run(useSetFacesPersonLabelMutation, mutation =>
      mutation.mutate({ faceIds: [3], personName: "Unknown - Other" })
    );

    expect(toasts.success.mock.calls[0]?.[0]).toBe(
      "The face was moved to 'Unknown - Other'. Anna won't be suggested for this face again."
    );
  });

  it("counts the faces labelled along in other frames of a burst on their own (#2754)", async () => {
    answer(200, {
      status: true,
      results: [3, 7, 8].map(id => ({ id, person: 4, person_name: "Dave" })),
      twin_ids: [7, 8],
    });
    await run(useSetFacesPersonLabelMutation, mutation => mutation.mutate({ faceIds: [3], personName: "Dave" }));

    expect(toasts.success.mock.calls[0]?.[0]).toBe(
      "1 face(s) were labeled as the person Dave. Also labeled 2 matching faces in the same burst or duplicate group"
    );
  });
});

describe("the Undo of a face toast (#127)", () => {
  /** The undo the last success toast was given. */
  const lastUndo = () => defined(toasts.success.mock.calls.at(-1)?.[1]?.undo, "the toast's undo");

  /** The last request: its URL and JSON body. */
  function lastRequest() {
    const [url, init] = defined(vi.mocked(fetch).mock.calls.at(-1), "a request");
    const body: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    return { url: String(url), body };
  }

  it("restores the faces a delete removed", async () => {
    answer(200, { status: true, deleted_ids: [1, 2], results: [], deleted: [], not_deleted: [] });
    await run(useDeleteFacesMutation, mutation => mutation.mutate({ faceIds: [1, 2, 3] }));

    answer(200, { restored_ids: [1, 2], write_error: null });
    await act(async () => {
      await lastUndo()();
    });

    expect(lastRequest().url).toContain("/restore-faces/");
    expect(lastRequest().body).toEqual({ face_ids: [1, 2] });
    expect(titles().at(-1)).toBe(i18n.t("toasts.restorefacestitle"));
  });

  it("gives labelled faces back the people the server says they had", async () => {
    const previous = [{ id: 3, person: null, cluster_person: 8, classification_person: null }];
    answer(200, { status: true, results: [{ id: 3, person: 4, person_name: "Dave" }], previous });
    await run(useSetFacesPersonLabelMutation, mutation => mutation.mutate({ faceIds: [3], personName: "Dave" }));

    answer(200, { restored_ids: [3], write_error: null });
    await act(async () => {
      await lastUndo()();
    });

    expect(lastRequest().url).toContain("/restore-face-labels/");
    expect(lastRequest().body).toEqual({ faces: previous });
  });

  it("offers no Undo for a labelling an older server sent no previous people for", async () => {
    answer(200, { status: true, results: [{ id: 3, person: 4, person_name: "Dave" }] });
    await run(useSetFacesPersonLabelMutation, mutation => mutation.mutate({ faceIds: [3], personName: "Dave" }));

    expect(toasts.success.mock.calls.at(-1)?.[1]?.undo).toBeUndefined();
  });
});
