/**
 * The delete-user dialog used to close in the same tick it fired the request,
 * with no error handling, so a refused or failed deletion went unnoticed.
 */
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api_client/api";
import { ModalUserDelete } from "./ModalUserDelete";

/** The callbacks the dialog hands to the delete mutation. */
type DeleteCallbacks = { onSuccess: () => void; onError: (error: unknown) => void };

const stubs = vi.hoisted(() => ({
  deleteUser: vi.fn<(userId: number, callbacks: DeleteCallbacks) => void>(),
  requestFailed: vi.fn<(title: string, message: string) => void>(),
  deletedToast: vi.fn<(username: string) => void>(),
}));

vi.mock("../../api_client/user/hooks", () => ({
  useDeleteUserMutation: () => ({ mutate: stubs.deleteUser, isPending: false }),
}));
vi.mock("../../service/notifications", () => ({
  notification: { requestFailed: stubs.requestFailed, deleteUser: stubs.deletedToast },
}));

beforeAll(() => {
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
});

let root: Root;
const onRequestClose = vi.fn<() => void>();

function renderAndConfirm() {
  act(() => {
    root.render(
      <MantineProvider>
        <ModalUserDelete isOpen userToDelete={{ id: 5, username: "mara" }} onRequestClose={onRequestClose} />
      </MantineProvider>
    );
  });
  // The confirm button is the last one in the dialog (after Cancel).
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>(".mantine-Modal-body button"));
  act(() => {
    buttons[buttons.length - 1].click();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});

describe("ModalUserDelete", () => {
  it("closes only once the deletion succeeded", () => {
    renderAndConfirm();

    expect(stubs.deleteUser).toHaveBeenCalledWith(5, expect.anything());
    expect(onRequestClose).not.toHaveBeenCalled();

    act(() => stubs.deleteUser.mock.calls[0][1].onSuccess());
    expect(onRequestClose).toHaveBeenCalledTimes(1);
    expect(stubs.deletedToast).toHaveBeenCalledWith("mara");
  });

  it("stays open and reports a refused deletion", () => {
    renderAndConfirm();

    act(() => stubs.deleteUser.mock.calls[0][1].onError(new ApiError("Bad Request", 400, "Cannot delete this user")));

    expect(onRequestClose).not.toHaveBeenCalled();
    expect(stubs.requestFailed).toHaveBeenCalledWith(expect.any(String), "Cannot delete this user");
  });

  it("leaves a 401 to the fetch client", () => {
    renderAndConfirm();

    act(() => stubs.deleteUser.mock.calls[0][1].onError(new ApiError("Unauthorized", 401)));

    expect(stubs.requestFailed).not.toHaveBeenCalled();
  });
});
