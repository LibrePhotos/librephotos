/**
 * An HDR video says so on its tile. The grid shows every video converted to
 * SDR, so without the badge nothing tells a 10-bit HDR clip from any other.
 */
import { Media } from "@librephotos/api-client";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { defined } from "../../util/defined.test-utils";
import { VideoOverlay } from "./VideoOverlay";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

async function render(item: {
  type: Media;
  video_length: string;
  is_hdr?: boolean;
  projection_type?: string | null;
  person_video_time?: number | null;
}) {
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => root.render(<VideoOverlay item={item} />));
  const badge = [...container.querySelectorAll("span")].find(span => span.textContent === "HDR");
  const sphere = [...container.querySelectorAll("span")].find(span => span.textContent === "360°");
  const moment = [...container.querySelectorAll("span")].find(
    span => span.getAttribute("title") === "phototile.personvideotime"
  );
  const text = container.textContent;
  await act(async () => root.unmount());
  return { badge, sphere, moment, text };
}

describe("VideoOverlay", () => {
  it("badges an HDR video, with a tooltip saying what that means", async () => {
    const { badge, text } = await render({ type: Media.VIDEO, video_length: "12", is_hdr: true });
    expect(badge).toBeDefined();
    expect(defined(badge).getAttribute("title")).toBe("phototile.hdrvideo");
    expect(text).toContain("00:12");
  });

  it("leaves an SDR video alone", async () => {
    const { badge } = await render({ type: Media.VIDEO, video_length: "12", is_hdr: false });
    expect(badge).toBeUndefined();
  });

  it("leaves a video from a backend that does not say alone", async () => {
    const { badge } = await render({ type: Media.VIDEO, video_length: "12" });
    expect(badge).toBeUndefined();
  });

  it("does not badge a motion photo", async () => {
    const { badge } = await render({ type: Media.MOTION_PHOTO, video_length: "2", is_hdr: true });
    expect(badge).toBeUndefined();
  });

  it("badges a 360° photo sphere (#483), hidden from screen readers like HDR", async () => {
    const { sphere } = await render({ type: Media.IMAGE, video_length: "", projection_type: "equirectangular" });
    expect(defined(sphere).getAttribute("title")).toBe("phototile.spherebadge");
    expect(defined(sphere).getAttribute("aria-hidden")).toBe("true");
  });

  it("leaves a flat photo alone", async () => {
    const { sphere, text } = await render({ type: Media.IMAGE, video_length: "", projection_type: null });
    expect(sphere).toBeUndefined();
    expect(text).toBe("");
  });

  it("shows in a person's photos where in the video the person is (#2762)", async () => {
    const { moment } = await render({ type: Media.VIDEO, video_length: "151", person_video_time: 42.5 });
    expect(defined(moment).textContent).toBe("0:42");
  });

  it("shows no moment elsewhere", async () => {
    const { moment } = await render({ type: Media.VIDEO, video_length: "151", person_video_time: null });
    expect(moment).toBeUndefined();
  });
});
