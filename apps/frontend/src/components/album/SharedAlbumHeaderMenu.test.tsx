/**
 * Leaving an album someone shared with you (#2210), from its page: the "⋮" has only Leave album,
 * which asks first, names the owner, and goes to "Shared with me" once the server agreed.
 */
import { MantineProvider } from "@mantine/core";
import { QueryClient } from "@tanstack/react-query";
import type { UseNavigateResult } from "@tanstack/react-router";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { useLeaveSharedAlbumMutation } from "../../api_client/albums/hooks";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { SharedAlbumHeaderMenu } from "./SharedAlbumHeaderMenu";

type Leave = ReturnType<typeof useLeaveSharedAlbumMutation>["mutate"];

const stubs = vi.hoisted(() => ({
  navigate: vi.fn<UseNavigateResult<string>>(),
  leave: vi.fn<Leave>(),
}));

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => stubs.navigate }));
vi.mock("../../api_client/albums/hooks", () => ({
  useLeaveSharedAlbumMutation: () => ({ mutate: stubs.leave, isPending: false }),
}));

const maria = { id: 1, username: "maria", first_name: "Maria", last_name: "Santos" };

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
  await i18n.changeLanguage("en");
});

let root: Root | undefined;

beforeEach(async () => {
  stubs.navigate.mockReset();
  stubs.leave.mockReset();
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    defined(root).render(
      <MantineProvider env="test">
        <SharedAlbumHeaderMenu album={{ id: 7, title: "Lisbon 2026", owner: maria }} />
      </MantineProvider>
    )
  );
});

afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.innerHTML = "";
});

function button(name: string, within: ParentNode = document.body): HTMLButtonElement {
  const found = Array.from(within.querySelectorAll("button")).find(
    el => el.getAttribute("aria-label") === name || el.textContent?.trim() === name
  );
  return defined(found, `button ${name}`);
}

async function openDialog() {
  await act(async () => button("Album actions").click());
  await act(async () => button("Leave album").click());
  return defined(document.body.querySelector('[role="dialog"]'), "the confirmation");
}

describe("SharedAlbumHeaderMenu", () => {
  it("offers only Leave album", async () => {
    await act(async () => button("Album actions").click());

    const items = Array.from(document.body.querySelectorAll('[role="menuitem"]')).map(el => el.textContent?.trim());
    expect(items).toEqual(["Leave album"]);
  });

  it("asks first, naming the album and its owner", async () => {
    const dialog = await openDialog();

    expect(dialog.textContent).toContain("Leave Lisbon 2026?");
    expect(dialog.textContent).toContain("Maria Santos can share it with you again.");
    expect(stubs.leave).not.toHaveBeenCalled();
  });

  it("leaves nothing when cancelled, and hands focus back to the menu button", async () => {
    const dialog = await openDialog();
    await act(async () => button("Cancel", dialog).click());

    expect(stubs.leave).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(button("Album actions"));
  });

  it("leaves once confirmed, and goes to Shared with me after the server agreed", async () => {
    const dialog = await openDialog();
    await act(async () => button("Leave album", dialog).click());

    expect(stubs.leave).toHaveBeenCalledTimes(1);
    const [params, options] = defined(stubs.leave.mock.calls[0]);
    expect(params).toEqual({ id: "7", title: "Lisbon 2026" });
    expect(stubs.navigate).not.toHaveBeenCalled();
    act(() => options?.onSuccess?.(undefined, params, undefined, { client: new QueryClient(), meta: undefined }));
    expect(stubs.navigate).toHaveBeenCalledWith({ to: "/sharing/withme/$tab", params: { tab: "albums" } });
  });
});
