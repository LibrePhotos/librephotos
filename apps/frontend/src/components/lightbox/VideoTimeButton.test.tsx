import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { defined } from "../../util/defined.test-utils";
import { createLightboxCommands, LightboxCommandsContext } from "./lightboxCommands";
import { VideoTimeButton } from "./VideoTimeButton";

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
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
});

describe("VideoTimeButton (#2762)", () => {
  it("shows the face's time and asks the player to play from there", async () => {
    const commands = createLightboxCommands();
    const seekTo = vi.fn<(seconds: number, name: string) => void>();
    commands.on("seekTo", seekTo);
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () =>
      root.render(
        <MantineProvider>
          <LightboxCommandsContext.Provider value={commands}>
            <VideoTimeButton seconds={75.4} name="Ben" />
          </LightboxCommandsContext.Provider>
        </MantineProvider>
      )
    );
    const button = defined(container.querySelector("button"));

    expect(button.textContent).toBe("1:15");
    expect(button.getAttribute("aria-label")).toBe("lightbox.videostart.playfromnamed");
    await act(async () => button.click());
    expect(seekTo).toHaveBeenCalledWith(75.4, "Ben");
    await act(async () => root.unmount());
  });
});
