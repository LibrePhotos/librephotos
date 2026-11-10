/**
 * The lightbox photo's zoom. A pinch used to multiply the scale it had already reached by the
 * gesture's whole scale on every move, so it ran away to the 4x cap; and a zoom stayed on the next
 * photo for one render, until an effect reset it.
 */
import { useGesture } from "@use-gesture/react";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it } from "vitest";
import { defined } from "../../util/defined.test-utils";
import { useLightboxZoom } from "./useLightboxZoom";

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

type Zoom = ReturnType<typeof useLightboxZoom>;

async function renderZoom(photo: string) {
  const scales: string[] = [];
  /** What use-gesture itself makes of the same pinch, from 1x. */
  const gesture: number[] = [];
  let latest: Zoom | undefined;
  function Probe({ id }: { id: string }) {
    const zoom = useLightboxZoom(id);
    latest = zoom;
    scales.push(`${id}:${zoom.scale}`);
    const reference = useGesture({ onPinch: state => void gesture.push(state.offset[0]) });
    return (
      <>
        <div data-testid="photo" {...zoom.bind()} />
        <div data-testid="reference" {...reference()} />
      </>
    );
  }
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const render = (id: string) => act(async () => root.render(<Probe id={id} />));
  await render(photo);
  const pinch = async (deltaY: number) => {
    for (const testId of ["photo", "reference"]) {
      const target = defined(container.querySelector(`[data-testid="${testId}"]`));
      await act(async () => {
        target.dispatchEvent(new WheelEvent("wheel", { deltaY, ctrlKey: true, bubbles: true, cancelable: true }));
      });
    }
  };
  return { current: () => defined(latest), scales, gesture, render, pinch };
}

describe("useLightboxZoom", () => {
  it("follows a pinch to the scale the gesture reached", async () => {
    const zoom = await renderZoom("a");

    await zoom.pinch(-20);
    await zoom.pinch(-20);
    await zoom.pinch(-20);

    const reached = defined(zoom.gesture.at(-1));
    expect(reached).toBeGreaterThan(1);
    expect(reached).toBeLessThan(4);
    expect(zoom.current().scale).toBeCloseTo(reached);
  });

  it("shows the next photo unzoomed from its first render", async () => {
    const zoom = await renderZoom("a");
    await act(async () => zoom.current().toggleZoom());
    expect(zoom.current().isZoomed).toBe(true);

    await zoom.render("b");

    expect(zoom.scales.filter(entry => entry.startsWith("b:"))).not.toContain("b:2");
    expect(zoom.current().isMagnified).toBe(false);
  });
});
