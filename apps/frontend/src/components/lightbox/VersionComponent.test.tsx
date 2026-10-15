/**
 * The file row of the info panel: it printed height × width (a landscape photo
 * read as portrait), showed a Windows backend's sub-path instead of the file
 * name, and built its "+N formats" plural in English code. Its camera row
 * printed a long exposure as a bare "2.5", which reads like 1/2.5 (#2275), and
 * `ISO200`, `ƒ / 2.8` and an English `58.14 kB` in a German UI (#2276).
 */
import type { FileVariant, Photo } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { makePhoto } from "./photoFixture.test-utils";
import { VersionComponent } from "./VersionComponent";

vi.mock("../../api_client/urls", () => ({ serverAddress: "" }));
// Its folder links are router links, which need a router this test has not got.
vi.mock("../common/BreadcrumbPath", () => ({ BreadcrumbPath: () => null }));
// Its own test covers the dialog.
vi.mock("../allmetadata/AllMetadataButton", () => ({
  AllMetadataButton: ({ variant }: { variant: string }) => <button type="button">all metadata {variant}</button>,
}));

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

// A RAW file next to the JPEG (type_id 4 is File.RAW_FILE on the backend).
const variant = (hash: string): FileVariant => ({
  hash,
  type: "raw",
  type_id: 4,
  is_main: false,
  path: `/lib/${hash}.raf`,
  filename: null,
});

async function render(overrides: Partial<Photo>, isPublic = false) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const photoDetail = makePhoto({
    image_hash: "abc",
    width: 4000,
    height: 3000,
    size: 2_000_000,
    image_path: ["/lib/photos/IMG_0001.jpg"],
    file_variants: [],
    ...overrides,
  });
  await act(async () => {
    root.render(
      <MantineProvider>
        <VersionComponent photoDetail={photoDetail} isPublic={isPublic} />
      </MantineProvider>
    );
  });
  return {
    container,
    /** The panel's lines, " | " between them. */
    lines: () =>
      Array.from(container.querySelectorAll("p, button"))
        .map(element => element.textContent)
        .join(" | "),
    async unmount() {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

async function renderText(overrides: Partial<Photo>, isPublic = false) {
  const panel = await render(overrides, isPublic);
  const text = panel.lines();
  await panel.unmount();
  return text;
}

describe("VersionComponent", () => {
  it("offers All metadata as a link in the file row, to the owner only", async () => {
    expect(await renderText({})).toContain("all metadata link");
    expect(await renderText({}, true)).not.toContain("all metadata");
  });

  it("shows width × height, megapixels and the size", async () => {
    expect(await renderText({})).toContain("4000 × 3000 · 12 MP · 2 MB");
  });

  it("shows the file name of a Windows path", async () => {
    const text = await renderText({ image_path: ["C:/lib/photos\\Family\\IMG_0033.jpg"] });
    expect(text).toContain("IMG_0033.jpg");
    expect(text).not.toContain("Family");
  });

  it("counts other formats with a translated plural", async () => {
    expect(await renderText({ file_variants: [variant("a")] })).toContain("+1 format |");
    expect(await renderText({ file_variants: [variant("a"), variant("b")] })).toContain("+2 formats");
  });

  it("gives a video its duration and codec instead of megapixels", async () => {
    const text = await renderText({
      video: true,
      width: 1920,
      height: 1080,
      video_length: "42.042",
      video_codec: "h264",
    });
    expect(text).toContain("1920 × 1080 · 0:42 · H.264 · 2 MB");
  });
});

describe("CameraInfoSection", () => {
  const fuji: Partial<Photo> = {
    camera: "Fujifilm X-T5",
    lens: "XF16-55mmF2.8 R LM WR",
    fstop: 5.6,
    shutter_speed: "1/250",
    iso: 200,
    focal_length: 23,
    focalLength35Equivalent: 35,
    exposure_compensation: 0.7,
  };

  it("splits the camera and the lens into two rows", async () => {
    const text = await renderText(fuji);
    expect(text).toContain("| Fujifilm X-T5 | 1/250 · ISO 200 · +0.7 EV |");
    expect(text).toContain("| XF16-55mmF2.8 R LM WR | ƒ/5.6 · 23 mm (35 mm equiv.) |");
  });

  it("puts the lens values on the camera row when there is no lens name", async () => {
    const text = await renderText({ camera: "X-T5", fstop: 2.8, iso: 100 });
    expect(text).toContain("| X-T5 | ƒ/2.8 · ISO 100 |");
  });

  it("formats in the UI language", async () => {
    await i18n.changeLanguage("de");
    try {
      const text = await renderText({ ...fuji, size: 59_535 });
      expect(text).toContain("ƒ/5,6");
      expect(text).toContain("+0,7 EV");
      // Decimal units with the unit name Intl gives German (#2201)
      expect(text.replace(/\s/g, " ")).toContain("59,5 kB");
    } finally {
      await i18n.changeLanguage("en");
    }
  });

  it("has no camera row for a photo without camera data", async () => {
    const withCamera = await render(fuji);
    expect(withCamera.container.querySelector(".tabler-icon-camera")).not.toBeNull();
    expect(withCamera.container.querySelector(".tabler-icon-aperture")).not.toBeNull();
    await withCamera.unmount();

    const panel = await render({});
    expect(panel.container.querySelector(".tabler-icon-camera")).toBeNull();
    expect(panel.container.querySelector(".tabler-icon-aperture")).toBeNull();
    await panel.unmount();
  });

  it("gives a long exposure its unit", async () => {
    expect(await renderText({ camera: "X-T5", shutter_speed: "2.5" })).toContain("| 2.5 s |");
  });

  it("keeps a fast shutter speed as a fraction", async () => {
    expect(await renderText({ camera: "X-T5", shutter_speed: "1/4000" })).toContain("| 1/4000 |");
  });

  it("leaves out an older backend's 0", async () => {
    expect(await renderText({ camera: "X-T5", shutter_speed: "0", iso: 100 })).toContain("| X-T5 | ISO 100 |");
  });
});

describe("Show more", () => {
  it("lists the rest of the exposure with labels", async () => {
    const panel = await render({
      camera: "X-T5",
      flash_fired: false,
      white_balance: "Auto",
      metering_mode: "Multi-segment",
      subjectDistance: 12.4,
    });
    const text = panel.container.textContent ?? "";
    for (const part of ["Flash", "Did not fire", "White balance", "Auto", "Metering", "Multi-segment", "12.4 m"]) {
      expect(text).toContain(part);
    }
    await panel.unmount();
  });

  it("names a metering mode this app does not know as stored, and leaves out Unknown", async () => {
    const known = await render({ metering_mode: "Evaluative" });
    expect(known.container.textContent).toContain("Evaluative");
    await known.unmount();
    const unknown = await render({ metering_mode: "Unknown", image_path: [] });
    expect(unknown.lines()).not.toContain("Show more");
    await unknown.unmount();
  });

  it("is not offered when it would open on nothing", async () => {
    expect(await renderText({ image_path: [] })).not.toContain("Show more");
  });

  it("is offered for the folder of the file", async () => {
    expect(await renderText({})).toContain("Show more");
  });
});
