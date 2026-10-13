import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { defined } from "../../util/defined.test-utils";
import { makePhoto } from "../lightbox/photoFixture.test-utils";
import { setUpMantineDom } from "../modals/confirmModal.test-utils";
import { CameraCard, hasCameraInfo } from "./CameraCard";

beforeAll(setUpMantineDom);

const mounted: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (mounted.length) await defined(mounted.pop())();
});

async function renderCard(photo: ReturnType<typeof makePhoto>) {
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MantineProvider env="test">
        <CameraCard photo={photo} />
      </MantineProvider>
    );
  });
  mounted.push(async () => act(async () => root.unmount()));
  return container;
}

describe("camera card", () => {
  it("shows the camera, the lens and the exposure as labelled values", async () => {
    const container = await renderCard(
      makePhoto({
        camera: "X-T5",
        lens: "XF16-55mm",
        fstop: 5.6,
        shutter_speed: "1/250",
        focal_length: 23.4,
        focalLength35Equivalent: 35,
        iso: 200,
        subjectDistance: 12.4,
      })
    );
    const text = container.textContent ?? "";
    for (const part of ["X-T5", "XF16-55mm", "ƒ/5.6", "1/250", "23 mm", "200", "photopage.camera.distance"]) {
      expect(text).toContain(part);
    }
    expect(text).toContain("photopage.camera.equivalent");
  });

  it("leaves out what the photo does not say", async () => {
    const container = await renderCard(makePhoto({ iso: 100 }));
    expect(container.textContent).not.toContain("photopage.camera.aperture");
    expect(container.textContent).not.toContain("photopage.camera.distance");
    expect(container.textContent).toContain("photopage.camera.iso");
  });

  it("has a card only when the photo says something about the camera", () => {
    expect(hasCameraInfo(makePhoto())).toBe(false);
    expect(hasCameraInfo(makePhoto({ shutter_speed: "0" }))).toBe(false);
    expect(hasCameraInfo(makePhoto({ camera: "X-T5" }))).toBe(true);
    expect(hasCameraInfo(makePhoto({ focal_length: 23 }))).toBe(true);
  });
});
