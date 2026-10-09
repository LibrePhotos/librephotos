/**
 * A day whose photos are all videos gets a video cover (the backend prefers a
 * still, but settles for a video). Its square thumbnail is an MP4, which the
 * card put in an <img>: a broken image on the memories page.
 */
import "@mantine/core/styles.css";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Memory, MemoryType } from "../../api_client/memories";
import { Media, type PigPhoto } from "../../api_client/photos/types";
import i18n from "../../i18n";
import { tempPigPhoto } from "../../util/util";
import { MemoryCard } from "./MemoryCard";

vi.mock("../../api_client/apiClient", () => ({ serverAddress: "" }));

let root: Root | undefined;
let container: HTMLDivElement;

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
  // jsdom has no media playback; the tile pauses and unloads its video on unmount
  HTMLMediaElement.prototype.pause = () => {};
  HTMLMediaElement.prototype.load = () => {};
  await i18n.changeLanguage("en");
});

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
});

function memoryWithCover(type: Media): Memory {
  const cover: PigPhoto = {
    ...tempPigPhoto("00000000-0000-4000-8000-000000000001"),
    image_hash: "cover",
    type,
    isTemp: false,
  };
  return {
    id: "m1",
    type: MemoryType.YEARS_AGO,
    years_ago: 2,
    year: 2024,
    date: "2024-10-09",
    start_date: "2024-10-09",
    end_date: "2024-10-09",
    location: "",
    numberOfItems: 1,
    cover,
    items: [cover],
  };
}

async function renderCard(memory: Memory) {
  container = document.createElement("div");
  document.body.appendChild(container);
  const cardRoot = createRoot(container);
  root = cardRoot;
  await act(async () => {
    cardRoot.render(
      <MantineProvider>
        <MemoryCard memory={memory} size={200} onPlay={() => {}} />
      </MantineProvider>
    );
  });
}

describe("MemoryCard", () => {
  it("shows a video cover as a video", async () => {
    await renderCard(memoryWithCover(Media.VIDEO));

    expect(container.querySelector("video")?.getAttribute("src")).toBe("/media/square_thumbnails/cover#t=0.001");
    expect(container.querySelector("img")).toBeNull();
  });

  it("shows a photo cover as an image", async () => {
    await renderCard(memoryWithCover(Media.IMAGE));

    expect(container.querySelector("img")?.getAttribute("src")).toBe("/media/square_thumbnails/cover");
    expect(container.querySelector("video")).toBeNull();
  });
});
