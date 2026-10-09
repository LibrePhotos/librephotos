/**
 * - The upload folder (#2141) is only sent when the admin changed it. The
 *   dialog's callers did not load the stored value, so sending the form's ""
 *   on every save reset a custom folder to the default without a word.
 * - "Add new user" passes {} as the user. Copying its undefined fields into
 *   the form made the inputs uncontrolled, so they kept showing the user that
 *   was edited before.
 * - The upload folder picker only shows while uploads are allowed.
 * - The upload location hint sits under the upload folder input and hides
 *   while that folder does not exist.
 */
import "@mantine/core/styles.css";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ModalUserEdit } from "./ModalUserEdit";

const stubs = vi.hoisted(() => ({
  updateUser: vi.fn(),
  siteSettings: { data: { allow_upload: true } } as { data?: { allow_upload: boolean } },
}));

vi.mock("../../api_client/auth", () => ({ useSignUpMutation: () => ({ mutate: () => {} }) }));
vi.mock("../../api_client/jobs", () => ({ useScanPhotosMutation: () => ({ mutate: () => {} }) }));
vi.mock("../../api_client/settings", () => ({ useGetSettingsQuery: () => stubs.siteSettings }));
vi.mock("../../api_client/user/hooks", () => ({
  useManageUpdateUserMutation: () => ({ mutate: stubs.updateUser }),
}));
vi.mock("../../service/notifications", () => ({ notification: { updateUserError: () => {} } }));
vi.mock("../setup/DirectoryPicker", () => ({
  DirectoryPicker: ({ value, onChange, onValidityChange, name, hint }: any) => (
    <div data-picker={name ?? "scan_directory"}>
      <input aria-label={name ?? "scan_directory"} value={value ?? ""} onChange={e => onChange(e.target.value)} />
      {/* Stands in for the picker's own path check reporting a missing folder */}
      <button type="button" data-invalid={name ?? "scan_directory"} onClick={() => onValidityChange?.(false)} />
      {hint}
    </div>
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

const bob = {
  id: 2,
  username: "bob",
  email: "bob@example.com",
  first_name: "Bob",
  last_name: "",
  scan_directory: "/data/bob",
};

let root: Root;

function renderModal(userToEdit: Record<string, unknown>, createNew = false) {
  act(() => {
    root.render(
      <MantineProvider>
        <ModalUserEdit
          isOpen
          createNew={createNew}
          userToEdit={userToEdit}
          userList={[bob]}
          onRequestClose={() => {}}
        />
      </MantineProvider>
    );
  });
}

function submit() {
  const form = document.querySelector("form") as HTMLFormElement;
  const saveButton = Array.from(form.querySelectorAll("button")).find(b => b.type === "submit") as HTMLButtonElement;
  act(() => {
    saveButton.click();
  });
}

const input = (name: string) => document.querySelector(`input[name="${name}"]`) as HTMLInputElement;
const sentUser = () => stubs.updateUser.mock.calls[0][0] as Record<string, unknown>;

beforeEach(() => {
  stubs.updateUser.mockReset();
  stubs.siteSettings = { data: { allow_upload: true } };
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});

describe("ModalUserEdit", () => {
  it("keeps a stored upload folder when the user is saved without changing it", () => {
    renderModal({ ...bob, upload_directory: "/data/bob/inbox" });
    expect((document.querySelector('input[aria-label="upload_directory"]') as HTMLInputElement).value).toBe(
      "/data/bob/inbox"
    );

    submit();

    expect(stubs.updateUser).toHaveBeenCalledTimes(1);
    expect(sentUser()).not.toHaveProperty("upload_directory");
  });

  it("does not reset the upload folder for a caller that never loaded it", () => {
    renderModal(bob);

    submit();

    expect(sentUser()).not.toHaveProperty("upload_directory");
  });

  it("sends an empty upload folder when the admin cleared it", () => {
    renderModal({ ...bob, upload_directory: "/data/bob/inbox" });
    const picker = document.querySelector('input[aria-label="upload_directory"]') as HTMLInputElement;
    act(() => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setValue.call(picker, "");
      picker.dispatchEvent(new Event("input", { bubbles: true }));
    });

    submit();

    expect(sentUser().upload_directory).toBe("");
  });

  it("opens 'Create user' empty after another user was edited", () => {
    renderModal(bob);
    expect(input("username").value).toBe("bob");

    renderModal({}, true);

    expect(input("username").value).toBe("");
    expect(input("email").value).toBe("");
    expect(input("first_name").value).toBe("");
  });

  it("hides the upload folder while uploads are switched off", () => {
    stubs.siteSettings = { data: { allow_upload: false } };
    renderModal(bob);

    expect(document.querySelector('input[aria-label="upload_directory"]')).toBeNull();
    expect(document.querySelector('input[aria-label="scan_directory"]')).not.toBeNull();
  });

  it("announces the upload location only while the upload folder exists", () => {
    renderModal({ ...bob, upload_directory: "/data/bob/inbox" });
    // Under the upload folder input it depends on, not under the scan directory.
    expect(document.querySelector('[data-picker="upload_directory"]')?.textContent).toContain("/data/bob/inbox/web");
    expect(document.querySelector('[data-picker="scan_directory"]')?.textContent).not.toContain("/data/bob/inbox/web");

    act(() => {
      (document.querySelector('button[data-invalid="upload_directory"]') as HTMLButtonElement).click();
    });

    expect(document.body.textContent).not.toContain("/data/bob/inbox/web");
  });
});
