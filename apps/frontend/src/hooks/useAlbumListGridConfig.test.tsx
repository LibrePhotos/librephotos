import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { useAlbumListGridConfig } from "./useAlbumListGridConfig";

let root: Root;
let container: HTMLDivElement;
let config: ReturnType<typeof useAlbumListGridConfig> | undefined;

beforeAll(() => {
  // @ts-ignore
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  // Wide enough for six albums per row
  window.innerWidth = 1400;
  window.innerHeight = 900;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

function Harness({ albums }: { albums: object[] }) {
  config = useAlbumListGridConfig(albums);
  return null;
}

const albums = (count: number) => Array.from({ length: count }, (_, id) => ({ id }));

const render = async (count: number) => {
  await act(async () => {
    root.render(<Harness albums={albums(count)} />);
  });
};

describe("useAlbumListGridConfig", () => {
  it("lays out a whole number of albums per row", async () => {
    await render(13);

    expect(config!.entriesPerRow).toBe(6);
    expect(config!.numberOfRows).toBe(3);
  });

  it("drops the rows a shrinking list no longer fills (places filtered by the map)", async () => {
    await render(13);
    await render(4);

    expect(config!.numberOfRows).toBe(1);
  });

  it("has no rows once the list is empty", async () => {
    await render(13);
    await render(0);

    expect(config!.numberOfRows).toBe(0);
  });
});
