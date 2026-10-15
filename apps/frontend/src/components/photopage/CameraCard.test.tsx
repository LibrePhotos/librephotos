import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { defined } from "../../util/defined.test-utils";
import { makePhoto } from "../lightbox/photoFixture.test-utils";
import { setUpMantineDom } from "../modals/confirmModal.test-utils";
import { CameraCard } from "./CameraCard";

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
        exposure_compensation: -0.7,
      })
    );
    const text = container.textContent ?? "";
    for (const part of [
      "X-T5",
      "XF16-55mm",
      "ƒ/5.6",
      "1/250",
      "23.4 mm",
      "200",
      "exif.equivalent",
      "exif.exposurebias",
    ]) {
      expect(text).toContain(part);
    }
  });

  it("leaves out what the photo does not say", async () => {
    const container = await renderCard(makePhoto({ iso: 100 }));
    expect(container.textContent).not.toContain("photopage.camera.aperture");
    expect(container.textContent).not.toContain("exif.exposurebias");
    expect(container.textContent).not.toContain("exif.showmore");
    expect(container.textContent).toContain("photopage.camera.iso");
  });

  it("keeps the rest behind Show more, labelled like the Details panel", async () => {
    const container = await renderCard(makePhoto({ camera: "X-T5", subjectDistance: 12.4, white_balance: "Manual" }));
    const toggle = defined(container.querySelector("button[aria-expanded]"));
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(container.textContent).toContain("exif.subjectdistance");
    expect(container.textContent).toContain("12.4 m");
    expect(container.textContent).toContain("exif.whitebalances.manual");
  });

  it("has no card when the photo says nothing about the camera", async () => {
    const title = "photopage.camera.title";
    expect((await renderCard(makePhoto())).textContent).not.toContain(title);
    expect((await renderCard(makePhoto({ shutter_speed: "0" }))).textContent).not.toContain(title);
    expect((await renderCard(makePhoto({ camera: "X-T5" }))).textContent).toContain(title);
    expect((await renderCard(makePhoto({ focal_length: 23 }))).textContent).toContain(title);
    expect((await renderCard(makePhoto({ flash_fired: true }))).textContent).toContain(title);
  });
});
