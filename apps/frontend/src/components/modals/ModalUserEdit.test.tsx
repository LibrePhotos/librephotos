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
 * - Saving a user that has no id yet (the dialog opened before the details
 *   loaded) sends nothing, but still says the save failed.
 */
import "@mantine/core/styles.css";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "../../api_client/user";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import type { DirectoryPicker } from "../setup/DirectoryPicker";
import { ModalUserEdit } from "./ModalUserEdit";

type PickerProps = Pick<
  React.ComponentProps<typeof DirectoryPicker>,
  "value" | "onChange" | "onValidityChange" | "name" | "hint"
>;

type SignUpParams = { username: string; password: string; email: string; first_name: string; last_name: string };

const stubs = vi.hoisted(() => ({
  signUp: vi.fn<(params: SignUpParams, callbacks: unknown) => void>(),
  updateUser: vi.fn<(user: Partial<User>, callbacks: unknown) => void>(),
  updateUserError: vi.fn<(message?: string) => void>(),
  siteSettings: { data: { allow_upload: true } } as { data?: { allow_upload: boolean } },
}));

vi.mock("../../api_client/auth", () => ({ useSignUpMutation: () => ({ mutate: stubs.signUp }) }));
vi.mock("../../api_client/jobs", () => ({ useScanPhotosMutation: () => ({ mutate: () => {} }) }));
vi.mock("../../api_client/settings", () => ({ useGetSettingsQuery: () => stubs.siteSettings }));
vi.mock("../../api_client/user/hooks", () => ({
  useManageUpdateUserMutation: () => ({ mutate: stubs.updateUser }),
}));
vi.mock("../../service/notifications", () => ({ notification: { updateUserError: stubs.updateUserError } }));
vi.mock("../setup/DirectoryPicker", () => ({
  DirectoryPicker: ({ value, onChange, onValidityChange, name, hint }: PickerProps) => (
    <div data-picker={name ?? "scan_directory"}>
      <input aria-label={name ?? "scan_directory"} value={value ?? ""} onChange={e => onChange(e.target.value)} />
      {/* Stands in for the picker's own path check reporting a missing folder */}
      <button type="button" data-invalid={name ?? "scan_directory"} onClick={() => onValidityChange?.(false)} />
      {hint}
    </div>
  ),
}));

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
  // jsdom has no ResizeObserver, Mantine's ScrollArea needs it
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
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

function renderModal(userToEdit: Partial<User>, createNew = false, firstTimeSetup = false) {
  act(() => {
    root.render(
      <MantineProvider>
        <ModalUserEdit
          isOpen
          createNew={createNew}
          firstTimeSetup={firstTimeSetup}
          userToEdit={userToEdit}
          userList={[bob]}
          onRequestClose={() => {}}
        />
      </MantineProvider>
    );
  });
}

function found<E extends Element>(element: E | null | undefined, what: string): E {
  if (!element) throw new Error(`${what} is not rendered`);
  return element;
}

function submit() {
  const form = found(document.querySelector("form"), "the form");
  const saveButton = found(
    Array.from(form.querySelectorAll("button")).find(b => b.type === "submit"),
    "the save button"
  );
  act(() => {
    saveButton.click();
  });
}

const input = (name: string) => found(document.querySelector<HTMLInputElement>(`input[name="${name}"]`), name);
const picker = (name: string) =>
  found(document.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`), `the ${name} picker`);
const sentUser = () => defined(stubs.updateUser.mock.calls[0])[0];
// React tracks the previous value on the node itself, so a plain assignment is swallowed.
const setInputValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;

beforeEach(() => {
  stubs.signUp.mockReset();
  stubs.updateUser.mockReset();
  stubs.updateUserError.mockReset();
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
    expect(picker("upload_directory").value).toBe("/data/bob/inbox");

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
    const uploadPicker = picker("upload_directory");
    act(() => {
      setInputValue?.call(uploadPicker, "");
      uploadPicker.dispatchEvent(new Event("input", { bubbles: true }));
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

  it("reports a failed save, without a request, for a user that has no id yet", () => {
    renderModal({});
    const username = input("username");
    act(() => {
      setInputValue?.call(username, "mara");
      username.dispatchEvent(new Event("input", { bubbles: true }));
    });

    submit();

    expect(stubs.updateUser).not.toHaveBeenCalled();
    expect(stubs.updateUserError).toHaveBeenCalledTimes(1);
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
      found(document.querySelector<HTMLButtonElement>('button[data-invalid="upload_directory"]'), "the check").click();
    });

    expect(document.body.textContent).not.toContain("/data/bob/inbox/web");
  });

  it("keeps the admin's edits while the dialog re-renders, and resets for another user", () => {
    const user = { ...bob };
    renderModal(user, true);
    const type = (element: HTMLInputElement, value: string) =>
      act(() => {
        setInputValue?.call(element, value);
        element.dispatchEvent(new Event("input", { bubbles: true }));
      });
    type(input("email"), "robert@example.com");
    // A matching password pair hands the dialog a new password, which must not reset the form
    type(input("password"), "s3cret");
    type(input("passwordConfirm"), "s3cret");
    expect(input("email").value).toBe("robert@example.com");

    // The parent re-rendering with the same user is not "another user"
    renderModal(user, true);
    expect(input("email").value).toBe("robert@example.com");

    renderModal({ ...bob }, true);
    expect(input("email").value).toBe("bob@example.com");
  });
});

describe("ModalUserEdit validation", () => {
  const type = (element: HTMLInputElement, value: string) =>
    act(() => {
      setInputValue?.call(element, value);
      element.dispatchEvent(new Event("input", { bubbles: true }));
    });
  const markInvalid = (name: string) =>
    act(() => {
      found(document.querySelector<HTMLButtonElement>(`button[data-invalid="${name}"]`), `the ${name} check`).click();
    });
  const alice = { id: 3, username: "alice", email: "", first_name: "", last_name: "", scan_directory: "/data/alice" };

  // The input is `required`, so a click on Save stops at the browser's own check; the form
  // still refuses a submit that gets past it.
  it("refuses a blank username", () => {
    renderModal(alice);
    type(input("username"), "");

    const form = found(document.querySelector("form"), "the form");
    act(() => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(stubs.updateUser).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(i18n.t("modaluseredit.errorusernamecannotbeblank"));
  });

  it("refuses another user's name, whatever its case", () => {
    renderModal(alice);
    type(input("username"), "BOB");

    submit();

    expect(stubs.updateUser).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(i18n.t("modaluseredit.errorusernameexists"));
  });

  it("refuses an invalid address but saves without one", () => {
    renderModal(alice);
    type(input("email"), "alice@");

    submit();

    expect(stubs.updateUser).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(i18n.t("modaluseredit.errorinvalidemail"));

    type(input("email"), "");
    submit();

    expect(sentUser()).toMatchObject({ id: 3, username: "alice", email: "" });
  });

  // The picker shows its own "does not exist" message; the form only refuses to save.
  it("refuses a scan directory that does not exist", () => {
    renderModal(alice);
    markInvalid("scan_directory");

    submit();

    expect(stubs.updateUser).not.toHaveBeenCalled();
  });

  it("refuses an upload folder that does not exist", () => {
    renderModal({ ...alice, upload_directory: "/data/alice/missing" });
    markInvalid("upload_directory");

    submit();

    expect(stubs.updateUser).not.toHaveBeenCalled();
  });

  // The picker's input is `required` there, so the browser asks for it before the form does.
  it("refuses to save without a scan directory during the first-run setup", () => {
    renderModal({ ...alice, scan_directory: "" }, false, true);

    submit();

    expect(stubs.updateUser).not.toHaveBeenCalled();

    renderModal({ ...alice, scan_directory: "" }, false, false);
    submit();

    expect(sentUser()).toMatchObject({ id: 3 });
  });

  // #695: the hand-written pattern refused these (upper-case TLD, one-letter label, two hyphens).
  it.each(["John@Example.COM", "a@b.co", "x@my-long-domain.example.org"])("accepts %s", email => {
    renderModal(alice);
    type(input("email"), email);

    submit();

    expect(sentUser()).toMatchObject({ email });
  });
});

describe("ModalUserEdit password", () => {
  const type = (element: HTMLInputElement, value: string) =>
    act(() => {
      setInputValue?.call(element, value);
      element.dispatchEvent(new Event("input", { bubbles: true }));
    });
  const lock = () =>
    found(
      document.querySelector<HTMLButtonElement>(
        `button[aria-label="${i18n.t("settings.password.tooltipeditbutton")}"]`
      ),
      "the lock button"
    );
  const typePasswords = (password: string, passwordConfirm: string) => {
    type(input("password"), password);
    type(input("passwordConfirm"), passwordConfirm);
  };

  it("keeps the password locked and unsent until the admin unlocks it", () => {
    renderModal(bob);
    expect(input("password").disabled).toBe(true);

    submit();

    expect(sentUser()).not.toHaveProperty("password");
  });

  it("sends a new password typed twice", () => {
    renderModal(bob);
    act(() => lock().click());
    typePasswords("s3cret!!", "s3cret!!");

    submit();

    expect(sentUser()).toMatchObject({ id: 2, password: "s3cret!!" });
  });

  // #2197
  it("does not send a password once the fields are locked again", () => {
    renderModal(bob);
    act(() => lock().click());
    typePasswords("s3cret!!", "s3cret!!");
    act(() => lock().click());

    submit();

    expect(sentUser()).not.toHaveProperty("password");
  });

  it("refuses passwords that differ", () => {
    renderModal(bob);
    act(() => lock().click());
    typePasswords("s3cret!!", "s3cret??");

    submit();

    expect(stubs.updateUser).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(i18n.t("settings.password.errormustmatch"));
  });

  // The unlocked inputs are `required`, so a click on Save stops at the browser's own check; the
  // form still refuses a submit that gets past it.
  it("refuses an unlocked but blank password", () => {
    renderModal(bob);
    act(() => lock().click());

    const form = found(document.querySelector("form"), "the form");
    act(() => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(stubs.updateUser).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(i18n.t("settings.password.errorcannotbeblank"));
  });

  it("refuses to create a user without a password", () => {
    renderModal({}, true);
    type(input("username"), "Mara");

    submit();

    expect(stubs.signUp).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(i18n.t("settings.password.errorcannotbeblank"));
  });

  it("creates a user only with a password typed twice", () => {
    renderModal({}, true);
    type(input("username"), "Mara");
    type(input("password"), "s3cret!!");

    submit();
    expect(document.body.textContent).toContain(i18n.t("settings.password.errormustretype"));
    expect(stubs.signUp).not.toHaveBeenCalled();

    // Every submit says what is missing, not only the first one
    type(input("password"), "s3cret!?");
    submit();
    expect(document.body.textContent).toContain(i18n.t("settings.password.errormustretype"));

    type(input("password"), "s3cret!!");
    type(input("passwordConfirm"), "s3cret!!");
    submit();

    expect(stubs.signUp).toHaveBeenCalledTimes(1);
    expect(defined(stubs.signUp.mock.calls[0])[0]).toEqual({
      username: "mara",
      password: "s3cret!!",
      email: "",
      first_name: "",
      last_name: "",
    });
  });
});
