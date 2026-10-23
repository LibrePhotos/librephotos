import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { defined } from "../../util/defined.test-utils";
import { PanoramaToggle } from "./PanoramaToggle";

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

async function renderToggle(props: React.ComponentProps<typeof PanoramaToggle>) {
  const container = document.createElement("div");
  await act(async () => {
    createRoot(container).render(
      <MantineProvider>
        <PanoramaToggle {...props} />
      </MantineProvider>
    );
  });
  return defined(container.querySelector("button"));
}

describe("PanoramaToggle", () => {
  it("says it is pressed while the 360° view is on, and toggles it", async () => {
    const toggle = vi.fn<() => void>();
    const button = await renderToggle({
      panorama: { active: true, blockedReason: undefined, toggle },
      look: "toolbar",
    });

    await act(async () => button.click());

    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.getAttribute("aria-label")).toBe("lightbox.panorama.toggle");
    expect(toggle).toHaveBeenCalledOnce();
  });

  it("names no shortcut on the photo page", async () => {
    const button = await renderToggle({
      panorama: { active: false, blockedReason: undefined, toggle: () => {} },
      look: "mat",
    });

    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(button.getAttribute("aria-label")).toBe("photopage.panorama");
  });

  it("stays focusable but does nothing when the browser has no WebGL", async () => {
    const toggle = vi.fn<() => void>();
    const button = await renderToggle({
      panorama: { active: false, blockedReason: "lightbox.panorama.nowebgl", toggle },
      look: "toolbar",
    });

    await act(async () => button.click());

    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.disabled).toBe(false);
    expect(toggle).not.toHaveBeenCalled();
  });
});
