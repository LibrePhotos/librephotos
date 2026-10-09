/**
 * An HDR video says so on its tile. The grid shows every video converted to
 * SDR, so without the badge nothing tells a 10-bit HDR clip from any other.
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { Media } from "../../api_client/photos/types";
import { defined } from "../../util/defined.test-utils";
import { VideoOverlay } from "./VideoOverlay";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

async function render(item: { type: Media; video_length: string; is_hdr?: boolean }) {
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => root.render(<VideoOverlay item={item} />));
  const badge = [...container.querySelectorAll("span")].find(span => span.textContent === "HDR");
  const text = container.textContent;
  await act(async () => root.unmount());
  return { badge, text };
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
});
