/**
 * A tile's top-right corner says what kind of file it is, in one badge style (review r6 #10): a
 * video's length as "0:07", RAW as text, HDR and 360° badges, and a stack's count.
 */
import { Media, PigPhoto } from "@librephotos/api-client";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { defined } from "../../util/defined.test-utils";
import { TopRightOverlay } from "./TopRightOverlay";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

async function render(fields: Record<string, unknown>) {
  const item = PigPhoto.parse({
    id: "00000000-0000-4000-8000-000000000001",
    image_hash: "h",
    aspectRatio: 1,
    ...fields,
  });
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => root.render(<TopRightOverlay item={item} />));
  const spans = [...container.querySelectorAll("span")];
  const badge = (text: string) => spans.find(span => span.textContent === text);
  const result = { hdr: badge("HDR"), sphere: badge("360°"), raw: badge("RAW"), text: container.textContent };
  await act(async () => root.unmount());
  return result;
}

describe("TopRightOverlay", () => {
  it("shows a video's length as m:ss", async () => {
    expect((await render({ type: Media.VIDEO, video_length: "7" })).text).toBe("0:07");
  });

  it("shows no length a backend did not measure", async () => {
    expect((await render({ type: Media.VIDEO, video_length: "None" })).text).toBe("");
  });

  it("badges an HDR video, with a tooltip saying what that means", async () => {
    const { hdr, text } = await render({ type: Media.VIDEO, video_length: "12", is_hdr: true });
    expect(defined(hdr).getAttribute("title")).toBe("phototile.hdrvideo");
    expect(text).toContain("0:12");
  });

  it("leaves an SDR video and a motion photo without the HDR badge", async () => {
    expect((await render({ type: Media.VIDEO, video_length: "12", is_hdr: false })).hdr).toBeUndefined();
    expect((await render({ type: Media.MOTION_PHOTO, video_length: "2", is_hdr: true })).hdr).toBeUndefined();
  });

  it("badges a 360° photo sphere (#483), hidden from screen readers like HDR", async () => {
    const { sphere } = await render({ projection_type: "equirectangular" });
    expect(defined(sphere).getAttribute("title")).toBe("phototile.spherebadge");
    expect(defined(sphere).getAttribute("aria-hidden")).toBe("true");
  });

  it("says RAW as text on a photo with a RAW file", async () => {
    expect((await render({ has_raw_variant: true })).raw).toBeDefined();
  });

  it("counts the photos of a stack", async () => {
    const stack = { id: "00000000-0000-4000-8000-000000000009", type: "burst", photo_count: 4, is_primary: true };
    expect((await render({ stacks: [stack] })).text).toBe("4");
  });

  it("leaves a flat photo alone", async () => {
    expect((await render({ projection_type: null })).text).toBe("");
  });
});
