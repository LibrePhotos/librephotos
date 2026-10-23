import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { defined } from "../../util/defined.test-utils";
import { usePanoramaMode, type PanoramaMode } from "./usePanoramaMode";

const stubs = vi.hoisted(() => ({ webgl: true, errors: [] as string[] }));

vi.mock("./photoSphere", () => ({ canShowPhotoSphere: () => stubs.webgl }));
vi.mock("../../service/notifications", () => ({
  notification: { error: (message: string) => stubs.errors.push(message) },
}));

type Args = Parameters<typeof usePanoramaMode>[0];

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  stubs.webgl = true;
  stubs.errors.length = 0;
});

/** Mounts the hook; `current()` is its latest answer, `rerender` gives it new arguments. */
async function renderMode(args: Args) {
  let latest: PanoramaMode | undefined;
  function Probe(props: Args) {
    latest = usePanoramaMode(props);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  const rerender = (next: Args) => act(async () => root.render(<Probe {...next} />));
  await rerender(args);
  return { current: () => defined(latest), rerender };
}

describe("usePanoramaMode", () => {
  it("offers nothing for a flat photo", async () => {
    const mode = await renderMode({ sphere: false, photoKey: "a" });

    await act(async () => mode.current().toggle());

    expect(mode.current()).toMatchObject({ available: false, active: false, blockedReason: undefined });
  });

  it("opens a sphere flat and toggles the 360° view", async () => {
    const mode = await renderMode({ sphere: true, photoKey: "a" });
    expect(mode.current()).toMatchObject({ available: true, active: false });

    await act(async () => mode.current().toggle());
    expect(mode.current().active).toBe(true);

    await act(async () => mode.current().toggle());
    expect(mode.current().active).toBe(false);
  });

  it("shows the next photo flat again", async () => {
    const mode = await renderMode({ sphere: true, photoKey: "a" });
    await act(async () => mode.current().toggle());

    await mode.rerender({ sphere: true, photoKey: "b" });

    expect(mode.current().active).toBe(false);
  });

  it("leaves the view on exit", async () => {
    const mode = await renderMode({ sphere: true, photoKey: "a" });
    await act(async () => mode.current().toggle());

    await act(async () => mode.current().exit());

    expect(mode.current().active).toBe(false);
  });

  it("goes back to flat with a toast when the viewer fails", async () => {
    const mode = await renderMode({ sphere: true, photoKey: "a" });
    await act(async () => mode.current().toggle());

    await act(async () => mode.current().fail());

    expect(mode.current().active).toBe(false);
    expect(stubs.errors).toEqual(["lightbox.panorama.loadfailed"]);
  });

  it("says why it cannot open without WebGL, and stays flat", async () => {
    stubs.webgl = false;
    const mode = await renderMode({ sphere: true, photoKey: "a" });

    await act(async () => mode.current().toggle());

    expect(mode.current()).toMatchObject({
      available: true,
      active: false,
      blockedReason: "lightbox.panorama.nowebgl",
    });
  });
});
