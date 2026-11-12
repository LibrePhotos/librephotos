/**
 * Edit in the lightbox toolbar: shown for the viewer's own still photo, not for a video or where the
 * lightbox offers no editor (a public page, a shared library, someone else's photo); E opens it like
 * the button. A browser that cannot run the editor keeps the button, which says why.
 */
import type { Photo } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import "../../i18n";
import { createLightboxCommands, LightboxCommandsContext } from "./lightboxCommands";
import { LightboxEditButton } from "./LightboxEditButton";
import { EditorClosedContext, PhotoEditorLauncherContext } from "./photoEditorLauncher";
import { makePhoto } from "./photoFixture.test-utils";

const stubs = vi.hoisted(() => ({ supported: true }));
vi.mock("../editor/engine/canEdit", () => ({ canEdit: () => stubs.supported }));

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
  stubs.supported = true;
});

async function renderButton(photo: Partial<Photo>, { type = "photo", launcher = true, editorClosed = false } = {}) {
  const open = vi.fn<() => void>();
  const commands = createLightboxCommands();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MantineProvider env="test">
        <LightboxCommandsContext.Provider value={commands}>
          <PhotoEditorLauncherContext.Provider value={launcher ? open : null}>
            <EditorClosedContext.Provider value={editorClosed}>
              <LightboxEditButton photo={makePhoto(photo)} type={type} />
            </EditorClosedContext.Provider>
          </PhotoEditorLauncherContext.Provider>
        </LightboxCommandsContext.Provider>
      </MantineProvider>
    );
  });
  mounted.push(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  const button = container.querySelector<HTMLButtonElement>('button[aria-label="Edit (E)"]');
  return { open, commands, button };
}

describe("LightboxEditButton", () => {
  it("opens the editor on the owner's still photo, from the button and from E", async () => {
    const { open, commands, button } = await renderButton({ video: false });
    expect(button).not.toBeNull();
    await act(async () => button?.click());
    expect(open).toHaveBeenCalledTimes(1);
    await act(async () => commands.emit("edit"));
    expect(open).toHaveBeenCalledTimes(2);
  });

  it("asks the viewer's focus trap for the focus once the editor has closed", async () => {
    expect((await renderButton({ video: false })).button?.hasAttribute("data-autofocus")).toBe(false);
    const { button } = await renderButton({ video: false }, { editorClosed: true });
    expect(button?.hasAttribute("data-autofocus")).toBe(true);
  });

  it("is not there for a video", async () => {
    expect((await renderButton({ video: true })).button).toBeNull();
    expect((await renderButton({ video: false }, { type: "video" })).button).toBeNull();
  });

  it("is not there where the lightbox offers no editor (public, shared or someone else's photo)", async () => {
    const { button, open, commands } = await renderButton({ video: false }, { launcher: false });
    expect(button).toBeNull();
    await act(async () => commands.emit("edit"));
    expect(open).not.toHaveBeenCalled();
  });

  it("says why it does nothing in a browser that cannot run the editor", async () => {
    stubs.supported = false;
    const { button, open, commands } = await renderButton({ video: false });
    expect(button?.getAttribute("aria-disabled")).toBe("true");
    const reason = document.getElementById(button?.getAttribute("aria-describedby") ?? "");
    expect(reason?.textContent).toContain("WebGL 2");
    await act(async () => button?.click());
    await act(async () => commands.emit("edit"));
    expect(open).not.toHaveBeenCalled();
  });

  it("is drawn switched on, and says so, for a photo with an edit", async () => {
    const { button } = await renderButton({
      video: false,
      edit: { version: 2, rendition: "ready", width: 4, height: 3 },
    });
    expect(button).toBeNull();
    const edited = document.querySelector<HTMLButtonElement>('button[aria-label="Edit (E). This photo is edited"]');
    expect(edited?.hasAttribute("data-active")).toBe(true);
    const plain = (await renderButton({ video: false, edit: null })).button;
    expect(plain?.hasAttribute("data-active")).toBe(false);
  });
});
