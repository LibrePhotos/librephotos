/**
 * The Library page's "Remove missing photos" dialog says how many photos it deletes: after an
 * unmounted disk that can be the whole library, which a generic warning hid (#2195).
 */
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { MissingPhotosBadge } from "./MissingPhotosBadge";

const stubs = vi.hoisted(() => ({ mutate: vi.fn<() => void>() }));

vi.mock("../../api_client/photos/hooks", () => ({
  useDeleteMissingPhotosMutation: () => ({ mutate: stubs.mutate }),
}));

let root: ReturnType<typeof createRoot>;
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
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const renderBadge = async (count: number) => {
  await act(async () => {
    root.render(
      // env="test": no transitions or portals, so the dialog renders in place
      <MantineProvider env="test">
        <MissingPhotosBadge count={count} />
      </MantineProvider>
    );
  });
};

const openDialog = async () => {
  const badge = container.querySelector<HTMLElement>(".mantine-Badge-root");
  if (!badge) throw new Error("the badge is not rendered");
  await act(async () => badge.click());
};

describe("MissingPhotosBadge", () => {
  it("names the number of photos the removal deletes", async () => {
    await renderBadge(4812);
    await openDialog();

    expect(container.textContent).toContain("This permanently deletes 4812 missing photos");
  });

  it("uses the singular for one photo", async () => {
    await renderBadge(1);
    await openDialog();

    expect(container.textContent).toContain("This permanently deletes 1 missing photo and its metadata");
  });

  // #2245: a plain Badge with onClick was neither focusable nor announced as a control.
  it("is a real button, so Tab reaches it and Enter or Space open the dialog", async () => {
    await renderBadge(3);

    const badge = container.querySelector<HTMLElement>(".mantine-Badge-root");
    expect(badge?.tagName).toBe("BUTTON");
    expect(badge?.getAttribute("type")).toBe("button");
    expect(badge?.tabIndex).toBe(0);
    expect(badge?.textContent).toContain("3");
  });

  it("deletes only on Confirm", async () => {
    await renderBadge(3);
    await openDialog();
    const confirm = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      el => el.textContent === i18n.t("confirm")
    );
    if (!confirm) throw new Error("no Confirm button");

    await act(async () => confirm.click());

    expect(stubs.mutate).toHaveBeenCalledTimes(1);
  });
});
