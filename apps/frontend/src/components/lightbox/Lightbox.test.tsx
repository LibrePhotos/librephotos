/**
 * What the lightbox hands its viewer: which item is shown as what, and where
 * it can step to.
 *
 * A public or shared page fetches no photo details, so the grid item is the
 * only thing that knows a video is a video; without it every video opened
 * there as its poster frame. And a timeline keeps placeholders for pages it
 * has not loaded yet, which must not be stepped onto.
 */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Lightbox } from "./Lightbox";
import type { LightboxItem } from "./lightbox.types";

const viewer = vi.fn();
const details = { current: undefined as object | undefined };

vi.mock("./ContentViewer", () => ({
  ContentViewer: (props: Record<string, unknown>) => {
    viewer(props);
    return null;
  },
}));

vi.mock("../../api_client/photos/hooks", () => ({
  useFetchPhotoDetailsQuery: () => ({ data: details.current }),
}));

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  viewer.mockClear();
  details.current = undefined;
});

async function open(idx2hash: LightboxItem[], selectedImage: string, isPublic = false) {
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <Lightbox
        idx2hash={idx2hash}
        selectedImage={selectedImage}
        isPublic={isPublic}
        onCloseRequest={() => {}}
        onChangedIndex={() => {}}
      />
    );
  });
  await act(async () => root.unmount());
  return viewer.mock.calls.at(-1)![0] as {
    type: string;
    enableZoom: boolean;
    nextSrc: string | null;
    prevSrc: string | null;
    gridItem?: LightboxItem;
  };
}

describe("Lightbox media type without photo details", () => {
  it("plays a video on a public page, where details are never fetched", async () => {
    const props = await open([{ id: "a", image_hash: "ha", type: "video" }], "a", true);

    expect(props.type).toBe("video");
    expect(props.enableZoom).toBe(false);
  });

  it("keeps a motion photo a still there, as its clip is not served to visitors", async () => {
    const props = await open([{ id: "a", image_hash: "ha", type: "motion_photo" }], "a", true);

    expect(props.type).toBe("photo");
  });

  it("waits for the details on a signed-in page instead of guessing", async () => {
    const props = await open([{ id: "a", image_hash: "ha", type: "video" }], "a");

    expect(props.type).toBe("photo");
  });

  it("goes by the details once they are there", async () => {
    details.current = { video: true, embedded_media: [] };

    const props = await open([{ id: "a", image_hash: "ha" }], "a");

    expect(props.type).toBe("video");
  });
});

describe("Lightbox neighbours", () => {
  it("steps to loaded neighbours", async () => {
    const props = await open(
      [
        { id: "a", image_hash: "ha" },
        { id: "b", image_hash: "hb" },
        { id: "c", image_hash: "hc" },
      ],
      "b"
    );

    expect(props.prevSrc).toBe("a");
    expect(props.nextSrc).toBe("c");
  });

  it("does not step onto a placeholder for a page that has not loaded", async () => {
    // As PhotoListView passes them today: a made-up id and no hash.
    const props = await open(
      [
        { id: "temp-0", image_hash: undefined as unknown as string },
        { id: "b", image_hash: "hb" },
        { id: "0", image_hash: "", isTemp: true },
      ],
      "b"
    );

    expect(props.prevSrc).toBeNull();
    expect(props.nextSrc).toBeNull();
  });
});

describe("Lightbox grid item for the details panel", () => {
  const items = [
    { id: "a", image_hash: "ha", date: "2023-05-01T10:00:00+00:00", location: "Rome" },
    { id: "b", image_hash: "hb", date: "2023-05-06T04:57:00+00:00", location: "Berlin" },
  ];

  it("hands a viewer who is not the owner the shown photo's grid entry", async () => {
    const props = await open(items, "b", true);

    expect(props.gridItem).toEqual(items[1]);
  });

  it("hands the owner none: the details have it all", async () => {
    const props = await open(items, "b");

    expect(props.gridItem).toBeUndefined();
  });
});
