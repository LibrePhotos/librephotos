/** #123: the Library page's folders card, for admins and users, and none without a library. */
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { setUpMantineDom } from "../modals/confirmModal.test-utils";
import { LibraryFoldersCard } from "./LibraryFoldersCard";

vi.mock("./LibraryFolderList", () => ({
  LibraryFolderList: ({ owner, userId, canManage }: { owner: string; userId: number; canManage: boolean }) => (
    <div data-list={`${owner}:${userId}:${canManage}`} />
  ),
}));

let container: HTMLElement;
let unmount: (() => Promise<void>) | undefined;

async function render(scanDirectory: string, isAdmin: boolean) {
  container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <MantineProvider env="test">
        <LibraryFoldersCard user={{ id: 4, username: "anna", scan_directory: scanDirectory }} isAdmin={isAdmin} />
      </MantineProvider>
    )
  );
  unmount = () => act(async () => root.unmount());
}

beforeAll(async () => {
  setUpMantineDom();
  await i18n.changeLanguage("en");
});

afterEach(async () => {
  await unmount?.();
  document.body.innerHTML = "";
});

describe("LibraryFoldersCard", () => {
  it("lists the own folders, managed by an admin", async () => {
    await render("/data/anna", true);
    expect(container.textContent).toContain("Library folders");
    expect(container.querySelector("[data-list]")?.getAttribute("data-list")).toBe("self:4:true");
  });

  it("tells a user to ask an admin", async () => {
    await render("/data/anna", false);
    expect(container.textContent).toContain("Ask an admin to add or remove one.");
    expect(container.querySelector("[data-list]")?.getAttribute("data-list")).toBe("self:4:false");
  });

  it("is not shown without a scan directory", async () => {
    await render("", true);
    expect(container.textContent).not.toContain("Library folders");
    expect(container.querySelector("[data-list]")).toBeNull();
  });
});
