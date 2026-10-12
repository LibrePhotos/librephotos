/**
 * The Profile page collects edits and offers them in the "Save changes?" dialog: Save sends them,
 * Cancel puts the stored values back. The password fields sit behind a lock; a typed password
 * goes with the save only while they are unlocked, and Cancel or a save leaves them locked and
 * empty again (#2197).
 */
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "../../api_client/user";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { Profile } from "./Profile";

type SaveCallbacks = { onSuccess?: () => void; onError?: (error: unknown) => void };

const stubs = vi.hoisted(() => ({
  user: {} as Record<string, unknown>,
  updateUser: vi.fn<(user: Partial<User>, callbacks: SaveCallbacks) => void>(),
}));

vi.mock("../../api_client/apiClient", () => ({ serverAddress: "" }));
vi.mock("../../api_client/auth/hooks", () => ({
  useAccessToken: () => ({ data: { access: { user_id: 1, is_admin: false } } }),
}));
vi.mock("../../api_client/user/hooks", () => ({
  useFetchUserSelfDetailsQuery: () => ({ data: stubs.user }),
  useUpdateAvatarMutation: () => ({ mutate: () => {} }),
  useUpdateUserMutation: () => ({ mutate: stubs.updateUser, isPending: false }),
}));
vi.mock("react-avatar-editor", () => ({ default: () => null }));
vi.mock("react-dropzone", () => ({ default: () => null }));

beforeAll(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
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
  // jsdom has no ResizeObserver, Mantine's Select needs it
  globalThis.ResizeObserver = class ResizeObserverStub implements ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  stubs.updateUser.mockReset();
  stubs.user = {
    id: 1,
    username: "mara",
    email: "mara@example.com",
    first_name: "Mara",
    last_name: "Lind",
    public_sharing: false,
    scan_directory: "/data/mara",
    avatar_url: null,
  };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        {/* env="test": no transitions or portals, so the save dialog renders in place */}
        <MantineProvider env="test">
          <Profile />
        </MantineProvider>
      </QueryClientProvider>
    );
  });
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

// React tracks the previous value on the node itself, so a plain assignment is swallowed.
const setInputValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;

async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    setInputValue?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function inputLabelled(text: string): HTMLInputElement {
  const label = Array.from(container.querySelectorAll("label")).find(element => element.textContent === text);
  const input = label?.htmlFor ? document.getElementById(label.htmlFor) : null;
  if (!(input instanceof HTMLInputElement)) throw new Error(`no input labelled "${text}"`);
  return input;
}

const passwordInputs = () => [...container.querySelectorAll<HTMLInputElement>('input[type="password"]')];
const lock = () =>
  defined(
    container.querySelector<HTMLButtonElement>('button[aria-label="Click to change the password"]'),
    "the lock button"
  );
const saveDialog = () => container.querySelector('[data-testid="save-changes-dialog"]');
const dialogButton = (label: string) =>
  defined(
    Array.from(saveDialog()?.querySelectorAll<HTMLButtonElement>("button") ?? []).find(
      element => element.textContent === label
    ),
    `the dialog's ${label} button`
  );
const sentUser = () => defined(stubs.updateUser.mock.calls[0], "the save request")[0];

async function typeNewPassword(password: string) {
  await act(async () => lock().click());
  for (const input of passwordInputs()) {
    await type(input, password);
  }
}

describe("Profile", () => {
  it("offers to save an edited name, and sends the edits without the read-only fields", async () => {
    expect(saveDialog()).toBeNull();

    await type(inputLabelled("First name"), "Marlene");
    await act(async () => dialogButton("Update").click());

    expect(sentUser()).toMatchObject({ id: 1, username: "mara", first_name: "Marlene", last_name: "Lind" });
    expect(sentUser()).not.toHaveProperty("scan_directory");
    expect(sentUser()).not.toHaveProperty("password");
  });

  it("puts the stored values back on Cancel", async () => {
    await type(inputLabelled("First name"), "Marlene");
    await act(async () => dialogButton("Cancel").click());

    expect(inputLabelled("First name").value).toBe("Mara");
    expect(saveDialog()).toBeNull();
    expect(stubs.updateUser).not.toHaveBeenCalled();
  });

  it("saves a new password typed twice", async () => {
    await typeNewPassword("s3cret!!");
    await act(async () => dialogButton("Update").click());

    expect(sentUser()).toMatchObject({ id: 1, password: "s3cret!!" });
  });

  it("does not save a password once the fields are locked again", async () => {
    await typeNewPassword("s3cret!!");
    await act(async () => lock().click());
    await type(inputLabelled("First name"), "Marlene");
    await act(async () => dialogButton("Update").click());

    expect(sentUser()).toMatchObject({ first_name: "Marlene" });
    expect(sentUser()).not.toHaveProperty("password");
  });
});
