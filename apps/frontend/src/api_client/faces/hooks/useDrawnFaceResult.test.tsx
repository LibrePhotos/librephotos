/**
 * A rough box: the server looks for the face in it (#1117). While it does, and when there is no face
 * in the box, the photo's People section says so and offers to keep the box as drawn.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { defined } from "../../../util/defined.test-utils";
import { settledMutationWith } from "../../../util/hookHarness.test-utils";
import { drawnFaceResults } from "../drawnFaceResults";
import { useAddFaceMutation } from "./useAddFaceMutation";
import { useDrawnFaceResult, type DrawnFaceOutcome } from "./useDrawnFaceResult";

const toasts = vi.hoisted(() => ({ requestFailed: vi.fn<(title: string, message: string) => void>() }));
vi.mock("../../../service/notifications", () => ({
  notification: { ...toasts, addFacesToPerson: () => {}, serverError: () => {} },
}));

const box = { top: 0.25, right: 0.6, bottom: 0.75, left: 0.4 };
const request = { photo: "h1", personName: "Anna", box, fit: true };
const added = {
  status: true,
  fitted: true,
  face: {
    face_id: 7,
    face_url: "/f.jpg",
    person: 4,
    person_name: "Anna",
    location: { top: 1, right: 2, bottom: 3, left: 0 },
  },
};

function respond(status: number, body: unknown) {
  const fetchMock = vi.fn<typeof fetch>(
    async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  drawnFaceResults.clear("h1");
});

describe("useAddFaceMutation with a rough box", () => {
  it("remembers a box with no face in it, and leaves the toast to the People section", async () => {
    respond(400, { errors: [{ field: "box", message: "No face was found in this box.", code: "no_face_in_box" }] });

    await settledMutationWith(useAddFaceMutation, request);

    expect(drawnFaceResults.get("h1")).toEqual({ state: "notfound", request });
    expect(toasts.requestFailed).not.toHaveBeenCalled();
  });

  it("forgets the box once the face is saved", async () => {
    drawnFaceResults.set({ state: "notfound", request });
    respond(201, added);

    await settledMutationWith(useAddFaceMutation, request);

    expect(drawnFaceResults.get("h1")).toBeUndefined();
  });

  it("forgets the box on any other failure, which is toasted", async () => {
    respond(409, { errors: [{ message: "there is already a face here", code: "conflict" }] });

    await settledMutationWith(useAddFaceMutation, request);

    expect(drawnFaceResults.get("h1")).toBeUndefined();
    expect(toasts.requestFailed).toHaveBeenCalledOnce();
  });
});

describe("useDrawnFaceResult", () => {
  async function render(imageHash: string | undefined) {
    const client = new QueryClient();
    let latest: DrawnFaceOutcome | null = null;
    function Host() {
      latest = useDrawnFaceResult(imageHash);
      return null;
    }
    const root = createRoot(document.createElement("div"));
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <Host />
        </QueryClientProvider>
      )
    );
    return { current: () => latest, unmount: () => act(() => root.unmount()) };
  }

  it("says nothing while no box was drawn", async () => {
    const hook = await render("h1");

    expect(hook.current()).toBeNull();
    hook.unmount();
  });

  it("says the face is looked for, then keeps the box as drawn", async () => {
    const fetchMock = respond(201, { ...added, fitted: false });
    drawnFaceResults.set({ state: "finding", request });
    const hook = await render("h1");
    expect(hook.current()?.state).toBe("finding");

    await act(async () => drawnFaceResults.set({ state: "notfound", request }));
    expect(hook.current()?.state).toBe("notfound");
    await act(async () => defined(hook.current()).keepBox());

    expect(String(fetchMock.mock.calls[0]?.[1]?.body)).toContain('"fit":false');
    expect(hook.current()).toBeNull();
    hook.unmount();
  });

  it("follows nothing without a photo", async () => {
    drawnFaceResults.set({ state: "finding", request });
    const hook = await render(undefined);

    expect(hook.current()).toBeNull();
    hook.unmount();
  });
});
