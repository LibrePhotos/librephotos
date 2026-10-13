/**
 * The My Albums rename dialog rendered its "already exists" error as
 * `<>{t(...)}, {{ name }}</>`: a plain object as a React child. Typing any
 * existing album name, or opening the dialog again after one rename (the old
 * title stayed in state and now matched the renamed album), threw "Objects are
 * not valid as a React child" and replaced the whole app with the router's
 * error screen. Both album pages now share this dialog.
 *
 * Both dialogs also closed the moment Rename or Delete was clicked, so a rename the
 * server refused (a 400, or a 502 while the backend is down) just looked like nothing
 * happened (#2222). They now stay open until the server answered, and say why it failed.
 */
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { useDeleteUserAlbumMutation, useRenameUserAlbumMutation } from "../../api_client/albums/hooks";
import { ApiError } from "../../api_client/apiError";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { DeleteUserAlbumModal, RenameUserAlbumModal } from "./UserAlbumModals";

type RenameRequest = Parameters<ReturnType<typeof useRenameUserAlbumMutation>["mutate"]>[0];
type DeleteRequest = Parameters<ReturnType<typeof useDeleteUserAlbumMutation>["mutate"]>[0];

// The requests the dialogs send; the server's answer is what each test makes these resolve or reject.
const stubs = vi.hoisted(() => ({
  rename: vi.fn<(request: RenameRequest) => Promise<void>>(),
  remove: vi.fn<(request: DeleteRequest) => Promise<void>>(),
}));

// Real mutations around stubbed requests, so pending and error states behave as in the app.
vi.mock("../../api_client/albums/hooks", async () => {
  const { useMutation } = await import("@tanstack/react-query");
  return {
    useRenameUserAlbumMutation: () => useMutation({ mutationFn: (request: RenameRequest) => stubs.rename(request) }),
    useDeleteUserAlbumMutation: () => useMutation({ mutationFn: (request: DeleteRequest) => stubs.remove(request) }),
  };
});

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

const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });

beforeEach(() => {
  stubs.rename.mockReset();
  stubs.remove.mockReset();
  // The server accepts the change unless a test says otherwise.
  stubs.rename.mockResolvedValue(undefined);
  stubs.remove.mockResolvedValue(undefined);
  onClose.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const onClose = vi.fn<() => void>();

async function renderRename(opened: boolean, existingTitles: string[]) {
  await act(async () => {
    root.render(
      // env="test": no transitions or portals, so the dialog renders in place
      <QueryClientProvider client={queryClient}>
        <MantineProvider env="test">
          <RenameUserAlbumModal
            opened={opened}
            onClose={onClose}
            albumId="1"
            albumTitle="Holiday"
            existingTitles={existingTitles}
          />
        </MantineProvider>
      </QueryClientProvider>
    );
  });
}

const input = () => defined(container.querySelector<HTMLInputElement>("input"));
const button = (label: string) =>
  defined(Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(el => el.textContent === label));

// React tracks the previous value on the node itself, so a plain assignment is swallowed.
const setInputValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;

/** Let the request settle and the dialog take in the answer. */
async function settle() {
  await act(async () => {
    await new Promise(resolve => {
      setTimeout(resolve, 0);
    });
  });
}

async function type(value: string) {
  await act(async () => {
    setInputValue?.call(input(), value);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("the rename dialog", () => {
  it("says a title is taken instead of crashing", async () => {
    await renderRename(true, ["Holiday", "Trip"]);
    await type(" trip ");

    expect(container.textContent).toContain("Album trip already exists.");
    expect(button("Rename").disabled).toBe(true);
  });

  it("does not offer to rename to an empty title", async () => {
    await renderRename(true, ["Holiday"]);
    expect(button("Rename").disabled).toBe(true);

    await type("   ");
    expect(button("Rename").disabled).toBe(true);
  });

  it("renames to the trimmed title", async () => {
    await renderRename(true, ["Holiday"]);
    await type(" Beach ");
    await act(async () => button("Rename").click());
    await settle();

    expect(stubs.rename).toHaveBeenCalledWith({ id: "1", title: "Holiday", newTitle: "Beach" });
    expect(onClose).toHaveBeenCalled();
  });

  it("stays open and says why when the server refused the rename", async () => {
    stubs.rename.mockRejectedValue(
      new ApiError("Bad Request", 400, "An album with this title already exists.", "/albums/user/1/")
    );
    await renderRename(true, ["Holiday"]);
    await type("Beach");
    await act(async () => button("Rename").click());
    await settle();

    expect(onClose).not.toHaveBeenCalled();
    expect(container.querySelector("[role=alert]")?.textContent).toContain("An album with this title already exists.");
    // The typed title is still there for another try
    expect(input().value).toBe("Beach");
  });

  it("does not close on a 502 either, and gives a readable reason", async () => {
    stubs.rename.mockRejectedValue(new ApiError("API error: 502 Bad Gateway", 502, null, "/albums/user/1/"));
    await renderRename(true, ["Holiday"]);
    await type("Beach");
    await act(async () => button("Rename").click());
    await settle();

    expect(onClose).not.toHaveBeenCalled();
    const alert = defined(container.querySelector("[role=alert]")).textContent;
    expect(alert).not.toContain("502 Bad Gateway");
    expect(alert).toContain(i18n.t("toasts.requestfailed"));
  });

  it("renames on Enter, but not to a taken title", async () => {
    await renderRename(true, ["Holiday", "Trip"]);
    const form = defined(container.querySelector("form"));
    const pressEnter = () =>
      act(async () => {
        form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      });

    await type("TRIP");
    await pressEnter();
    expect(stubs.rename).not.toHaveBeenCalled();

    await type("Beach");
    await pressEnter();
    expect(stubs.rename).toHaveBeenCalledWith({ id: "1", title: "Holiday", newTitle: "Beach" });
  });

  it("opens empty again after a rename, even though that title now exists", async () => {
    await renderRename(true, ["Holiday"]);
    await type("Beach");
    await act(async () => button("Rename").click());
    await settle();

    // The list refetched with the new title; the dialog is closed and opened again.
    await renderRename(false, ["Beach"]);
    await renderRename(true, ["Beach"]);

    expect(input().value).toBe("");
    expect(container.textContent).not.toContain("already exists");
  });
});

describe("the delete dialog", () => {
  it("deletes the album it was opened for", async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <MantineProvider env="test">
            <DeleteUserAlbumModal opened onClose={onClose} albumId="7" albumTitle="Trip" />
          </MantineProvider>
        </QueryClientProvider>
      );
    });
    await act(async () => button("Delete album").click());
    await settle();

    expect(stubs.remove).toHaveBeenCalledWith({ id: "7", albumTitle: "Trip" });
    expect(onClose).toHaveBeenCalled();
  });

  it("stays open and says why when the delete failed", async () => {
    stubs.remove.mockRejectedValue(new ApiError("Forbidden", 403, "You do not own this album.", "/albums/user/7/"));
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <MantineProvider env="test">
            <DeleteUserAlbumModal opened onClose={onClose} albumId="7" albumTitle="Trip" />
          </MantineProvider>
        </QueryClientProvider>
      );
    });
    await act(async () => button("Delete album").click());
    await settle();

    expect(onClose).not.toHaveBeenCalled();
    expect(container.querySelector("[role=alert]")?.textContent).toContain("You do not own this album.");
  });

  it("reports the delete once it went through, for the album page to leave", async () => {
    const onDeleted = vi.fn<() => void>();
    let answer: () => void = () => {};
    stubs.remove.mockImplementation(
      () =>
        new Promise(resolve => {
          answer = () => resolve(undefined);
        })
    );
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <MantineProvider env="test">
            <DeleteUserAlbumModal opened onClose={onClose} albumId="7" albumTitle="Trip" onDeleted={onDeleted} />
          </MantineProvider>
        </QueryClientProvider>
      );
    });
    await act(async () => button("Delete album").click());
    await settle();
    // Not while the server has not answered
    expect(onDeleted).not.toHaveBeenCalled();

    answer();
    await settle();
    expect(onDeleted).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalled();
  });

  it("does not report a delete that failed", async () => {
    const onDeleted = vi.fn<() => void>();
    stubs.remove.mockRejectedValue(new ApiError("Forbidden", 403, "You do not own this album.", "/albums/user/7/"));
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <MantineProvider env="test">
            <DeleteUserAlbumModal opened onClose={onClose} albumId="7" albumTitle="Trip" onDeleted={onDeleted} />
          </MantineProvider>
        </QueryClientProvider>
      );
    });
    await act(async () => button("Delete album").click());
    await settle();

    expect(onDeleted).not.toHaveBeenCalled();
  });
});
