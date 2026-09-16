/**
 * Repro for https://github.com/LibrePhotos/librephotos/issues/492
 *
 *   "Usability issues regarding setting a path"
 *
 * The backend rejects a scan directory that is outside DATA_ROOT or that does
 * not exist (ManageUserSerializer.apply_scan_directory raises a
 * ValidationError, DRF answers 400). The frontend never showed that:
 * `FetchClient.handleError` only reacts to 500 and 401, the mutation hook has
 * no `onError`, and ModalUserEdit called `closeModal()` unconditionally right
 * after `updateUser(...)`.
 *
 * The result is a silent failure: the modal closes, no error is shown and the
 * old path quietly stays in place.
 */
import "@mantine/core/styles.css";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ModalUserEdit } from "../components/modals/ModalUserEdit";

const stubs = vi.hoisted(() => ({
  updateUser: vi.fn(),
  updateUserError: vi.fn(),
  // Mirrors what the backend answers for a scan directory outside DATA_ROOT.
  backendError: new Error("Scan directory must be inside the data root."),
}));

vi.mock("../api_client/auth", () => ({ useSignUpMutation: () => ({ mutate: () => {} }) }));
vi.mock("../api_client/jobs", () => ({ useScanPhotosMutation: () => ({ mutate: () => {} }) }));
vi.mock("../api_client/user/hooks", () => ({
  useManageUpdateUserMutation: () => ({ mutate: stubs.updateUser }),
}));
vi.mock("../service/notifications", () => ({
  notification: { updateUserError: stubs.updateUserError },
}));
vi.mock("../components/setup/DirectoryPicker", () => ({
  DirectoryPicker: ({ value, onChange }: any) => (
    <input
      aria-label="scan_directory"
      name="scan_directory"
      value={value ?? ""}
      onChange={e => onChange(e.target.value)}
    />
  ),
}));

beforeAll(() => {
  // @ts-ignore - jsdom has no matchMedia, MantineProvider needs it
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
  // @ts-ignore - jsdom has no ResizeObserver, Mantine's ScrollArea needs it
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  // @ts-ignore
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

const userToEdit = {
  id: 2,
  username: "bob",
  email: "bob@example.com",
  first_name: "",
  last_name: "",
  scan_directory: "/data/bob",
};

function renderModal(onRequestClose: () => void) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    createRoot(container).render(
      <MantineProvider>
        <ModalUserEdit
          isOpen
          createNew={false}
          userToEdit={userToEdit}
          userList={[userToEdit]}
          onRequestClose={onRequestClose}
        />
      </MantineProvider>
    );
  });
  return container;
}

function submit() {
  const form = document.querySelector("form") as HTMLFormElement;
  const saveButton = Array.from(form.querySelectorAll("button")).find(b => b.type === "submit") as HTMLButtonElement;
  act(() => {
    saveButton.click();
  });
}

describe("issue #492 - saving a rejected scan directory must not fail silently", () => {
  beforeEach(() => {
    stubs.updateUser.mockReset();
    stubs.updateUserError.mockReset();
    document.body.innerHTML = "";
  });

  it("keeps the modal open and reports the backend message when the save is rejected", () => {
    stubs.updateUser.mockImplementation((_data: unknown, options: any) => {
      options?.onError?.(stubs.backendError);
    });
    const onRequestClose = vi.fn();
    renderModal(onRequestClose);

    submit();

    expect(stubs.updateUser).toHaveBeenCalledTimes(1);
    expect(stubs.updateUserError).toHaveBeenCalledWith("Scan directory must be inside the data root.");
    expect(onRequestClose).not.toHaveBeenCalled();
  });

  it("closes the modal once the save actually succeeded", () => {
    stubs.updateUser.mockImplementation((_data: unknown, options: any) => {
      options?.onSuccess?.();
    });
    const onRequestClose = vi.fn();
    renderModal(onRequestClose);

    submit();

    expect(stubs.updateUserError).not.toHaveBeenCalled();
    expect(onRequestClose).toHaveBeenCalledTimes(1);
  });
});
