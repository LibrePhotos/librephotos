/**
 * The folder page's ⋮ (#524): Detect faces again in this folder asks first, saying how many photos
 * it covers and that deleted faces are not found again, then sends the folder's path.
 */
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { expectDisabledWithReason } from "../common/disabledReason.test-utils";
import { click, dialogButton, openDialog, setUpMantineDom } from "../modals/confirmModal.test-utils";
import { FolderActionsMenu } from "./FolderActionsMenu";

const stubs = vi.hoisted(() => ({ detect: vi.fn<(scope: object) => void>(), busy: false }));
vi.mock("../../api_client/faces/hooks/useDetectFacesAgainMutation", () => ({
  useDetectFacesAgainMutation: () => ({ mutate: stubs.detect }),
}));
vi.mock("../../hooks/useJobQueue", () => ({ useJobQueue: () => ({ busy: stubs.busy, job: null }) }));

beforeAll(async () => {
  setUpMantineDom();
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  vi.clearAllMocks();
  stubs.busy = false;
});

let unmount: (() => Promise<void>) | undefined;

afterEach(async () => {
  await unmount?.();
  unmount = undefined;
  document.body.innerHTML = "";
});

const ui = <FolderActionsMenu folderPath="/data/alice/2025 Porto" folderName="2025 Porto" photoCount={214} />;

async function openItem(): Promise<HTMLButtonElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(<MantineProvider env="test">{ui}</MantineProvider>));
  unmount = () => act(async () => root.unmount());
  await click(defined(document.querySelector<HTMLButtonElement>('[aria-label="Folder actions"]')));
  return defined(
    document.querySelector<HTMLButtonElement>(`[role="menuitem"][aria-label="${i18n.t("folderactions.detectfaces")}"]`)
  );
}

describe("FolderActionsMenu", () => {
  it("asks first, then detects faces in the folder", async () => {
    await click(await openItem());

    const dialog = defined(openDialog());
    expect(dialog.textContent).toContain("Detect faces again in 2025 Porto?");
    expect(dialog.textContent).toContain("214 photos");
    expect(dialog.textContent).toContain("Faces you deleted are not found again");
    expect(stubs.detect).not.toHaveBeenCalled();

    await click(dialogButton(i18n.t("folderactions.detectfacesconfirm")));

    expect(stubs.detect).toHaveBeenCalledWith({ path: "/data/alice/2025 Porto" });
  });

  it("starts nothing when cancelled", async () => {
    await click(await openItem());
    await click(dialogButton(i18n.t("cancel")));
    await act(async () => {});

    expect(stubs.detect).not.toHaveBeenCalled();
  });

  it("waits for a busy queue and says so", async () => {
    stubs.busy = true;
    const item = await openItem();

    expectDisabledWithReason(item, i18n.t("jobs.queuebusy.reason"));
    await click(item);
    expect(openDialog()).toBeNull();
  });
});
