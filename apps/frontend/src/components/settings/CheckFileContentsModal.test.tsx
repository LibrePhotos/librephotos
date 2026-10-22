/**
 * The Check file contents dialog (#2040): every user by default, one user and a folder of their
 * library on request, the equivalent command, and a refused folder said on its field.
 */
import { ApiError, type CheckFileContentsScope, type ListUser } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { setUpMantineDom } from "../modals/confirmModal.test-utils";
import { CheckFileContentsModal } from "./CheckFileContentsModal";
import { makeCheckFileContentsSchema } from "./CheckFileContentsModal.schema";

type Callbacks = Readonly<{ onSuccess: () => void; onError: (error: unknown) => void }>;

const stubs = vi.hoisted(() => ({
  check: vi.fn<(scope: CheckFileContentsScope, callbacks: Callbacks) => void>(),
  saveFailed: vi.fn<(message: string | null) => void>(),
}));

const users: ListUser[] = [
  {
    id: 3,
    username: "mina",
    first_name: "",
    last_name: "",
    public_photo_count: 0,
    public_photo_samples: [],
    scan_directory: "/photos/mina",
  },
  { id: 4, username: "guest", first_name: "", last_name: "", public_photo_count: 0, public_photo_samples: [] },
];

vi.mock("../../api_client/jobs/hooks", () => ({
  useCheckFileContentsMutation: () => ({ mutate: stubs.check, isPending: false }),
}));
vi.mock("../../api_client/user/hooks", () => ({
  useFetchUserListQuery: () => ({ data: users }),
}));
vi.mock("../../service/notifications", () => ({ notification: { saveFailed: stubs.saveFailed } }));

const onClose = vi.fn<() => void>();

let root: Root;
let container: HTMLDivElement;

beforeAll(async () => {
  setUpMantineDom();
  // The Select's dropdown scrolls its selected option into view; jsdom does not lay out.
  Element.prototype.scrollIntoView = () => {};
  await i18n.changeLanguage("en");
});

beforeEach(async () => {
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      // env="test": no transitions or portals, so the dialog renders in place
      <MantineProvider env="test">
        <CheckFileContentsModal opened onClose={onClose} />
      </MantineProvider>
    );
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const inputs = () => Array.from(container.querySelectorAll<HTMLInputElement>("input"));
const folderInput = () =>
  defined(
    inputs().find(el => el.placeholder === "For example Phone/2025"),
    "the folder input"
  );
const usersInput = () => defined(inputs()[0], "the users select");
const setInputValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;

async function pickUser(name: string) {
  await act(async () => usersInput().click());
  const option = defined(
    Array.from(container.querySelectorAll<HTMLElement>("[role=option]")).find(el => el.textContent === name),
    `the ${name} option`
  );
  await act(async () => option.click());
}

async function typeFolder(value: string) {
  await act(async () => {
    setInputValue?.call(folderInput(), value);
    folderInput().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function submit() {
  const form = defined(container.querySelector("form"), "the form");
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

const lastCallbacks = () => defined(stubs.check.mock.calls[0], "a check call")[1];

describe("CheckFileContentsModal", () => {
  it("checks every user's library by default, with no folder", async () => {
    expect(usersInput().value).toBe("All users");
    expect(folderInput().disabled).toBe(true);
    expect(container.textContent).toContain("python manage.py rehash_files");

    await submit();

    expect(stubs.check).toHaveBeenCalledWith({ user_id: null, folder: "" }, expect.anything());
  });

  it("offers only the users with a scan directory", async () => {
    await act(async () => usersInput().click());

    const options = Array.from(container.querySelectorAll("[role=option]")).map(el => el.textContent);
    expect(options).toEqual(["All users", "mina"]);
  });

  it("checks one folder of one user and shows the same command", async () => {
    await pickUser("mina");
    expect(folderInput().disabled).toBe(false);
    expect(container.textContent).toContain("Inside /photos/mina.");

    await typeFolder(" Phone/2025 ");
    await submit();

    expect(container.textContent).toContain("python manage.py rehash_files --user mina --path Phone/2025");
    expect(stubs.check).toHaveBeenCalledWith({ user_id: 3, folder: "Phone/2025" }, expect.anything());
    lastCallbacks().onSuccess();
    expect(onClose).toHaveBeenCalled();
  });

  it("refuses a folder that climbs out of the scan directory", async () => {
    await pickUser("mina");
    await typeFolder("../other");
    await submit();

    expect(stubs.check).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Use a folder inside the scan directory, without "..".');
  });

  it("puts the server's refusal on the folder field", async () => {
    await pickUser("mina");
    await typeFolder("Gone");
    await submit();

    const refusal = new ApiError(400, "/check-file-contents/", "Bad Request", {}, "The folder does not exist.");
    await act(async () => lastCallbacks().onError(refusal));

    expect(container.textContent).toContain("The folder does not exist.");
    expect(onClose).not.toHaveBeenCalled();
    expect(stubs.saveFailed).not.toHaveBeenCalled();
  });

  it("toasts any other failure", async () => {
    await submit();

    await act(async () => lastCallbacks().onError(new ApiError(503, "/check-file-contents/", "Unavailable")));

    expect(stubs.saveFailed).toHaveBeenCalledWith(null);
  });

  it("closes on Cancel without starting", async () => {
    const cancel = defined(
      Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(el => el.textContent === "Cancel"),
      "the Cancel button"
    );
    await act(async () => cancel.click());

    expect(onClose).toHaveBeenCalled();
    expect(stubs.check).not.toHaveBeenCalled();
  });
});

describe("the check file contents schema", () => {
  const schema = makeCheckFileContentsSchema(i18n.t);

  it("takes a folder below the scan directory, or none", () => {
    expect(schema.safeParse({ userId: "3", folder: "Phone/2025" }).success).toBe(true);
    expect(schema.safeParse({ userId: "all", folder: "" }).success).toBe(true);
  });

  it("refuses a .. step with either separator", () => {
    expect(schema.safeParse({ userId: "3", folder: "a/../b" }).success).toBe(false);
    expect(schema.safeParse({ userId: "3", folder: "..\\b" }).success).toBe(false);
  });
});
