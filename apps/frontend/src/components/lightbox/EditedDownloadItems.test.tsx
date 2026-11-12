/**
 * The owner's download items for an edited photo in the lightbox's ⋮: the edited JPEG and the
 * original saved under their own names once the rendition is ready, the edited one waiting with its
 * reason while the server makes it, and nothing extra for a photo without an edit.
 */
import type { Photo } from "@librephotos/api-client";
import { MantineProvider, Menu } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import "../../i18n";
import { EditedDownloadItems } from "./EditedDownloadItems";
import { makePhoto } from "./photoFixture.test-utils";

const save = vi.hoisted(() => vi.fn<(url: string, name: string) => Promise<void>>(() => Promise.resolve()));
vi.mock("../../api_client/media/saveMedia", () => ({ saveMediaFile: save }));

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

const mounted: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const unmount of mounted.splice(0)) await unmount();
  save.mockClear();
});

async function renderItems(photo: Partial<Photo>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MantineProvider env="test">
        <Menu opened withinPortal={false}>
          <Menu.Target>
            <button type="button">menu</button>
          </Menu.Target>
          <Menu.Dropdown>
            <EditedDownloadItems photo={makePhoto({ image_hash: "h1", image_path: ["/photos/niaz.jpg"], ...photo })} />
          </Menu.Dropdown>
        </Menu>
      </MantineProvider>
    );
  });
  mounted.push(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  const item = (text: string) =>
    [...container.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(element => element.textContent === text);
  return { container, item };
}

// An open Mantine Menu (its floating position and focus handling) costs seconds in jsdom on a busy machine.
describe("EditedDownloadItems", { timeout: 15000 }, () => {
  it("saves the edited and the original file of a ready edit, each under its name", async () => {
    const { item } = await renderItems({ edit: { version: 3, rendition: "ready", width: 4, height: 3 } });
    await act(async () => item("Download edited")?.click());
    expect(save.mock.lastCall?.[0]).toMatch(/\/media\/photos\/h1\?v=3$/);
    expect(save.mock.lastCall?.[1]).toBe("niaz-edited.jpg");
    await act(async () => item("Download original")?.click());
    expect(save.mock.lastCall?.[0]).toMatch(/\/media\/photos\/h1\?original=1$/);
    expect(save.mock.lastCall?.[1]).toBe("niaz.jpg");
  });

  it("holds the edited download back with its reason while the rendition is pending", async () => {
    const { item, container } = await renderItems({ edit: { version: 3, rendition: "pending", width: 4, height: 3 } });
    const edited = item("Download edited");
    expect(edited?.getAttribute("aria-disabled")).toBe("true");
    await act(async () => edited?.click());
    expect(save).not.toHaveBeenCalled();
    const reason = container.ownerDocument.getElementById(edited?.getAttribute("aria-describedby") ?? "");
    expect(reason?.textContent).toContain("still being prepared");
    expect(item("Download original")).toBeDefined();
  });

  it("adds nothing for a photo without an edit, which downloads as before", async () => {
    const { container } = await renderItems({ edit: null });
    expect(container.querySelectorAll('[role="menuitem"]')).toHaveLength(0);
  });
});
