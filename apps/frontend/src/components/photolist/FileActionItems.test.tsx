/**
 * Rescan files (#2214) and Detect faces again (#524): the items send the user's own photo ids, are
 * not shown for a selection of someone else's photos, and say why they are off (Select all, more
 * than 1,000 photos, a busy queue) instead of doing nothing.
 */
import { PigPhoto } from "@librephotos/api-client";
import { MantineProvider, Menu } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { expectDisabledWithReason } from "../common/disabledReason.test-utils";
import { setUpMantineDom } from "../modals/confirmModal.test-utils";
import { FileActionItems, MAX_FILE_ACTION_PHOTOS, SelectionFileItems } from "./FileActionItems";

const stubs = vi.hoisted(() => ({
  rescan: vi.fn<(photoIds: readonly string[]) => void>(),
  detect: vi.fn<(scope: object) => void>(),
  busy: false,
}));
vi.mock("../../api_client/jobs/hooks/useRescanSelectedPhotosMutation", () => ({
  useRescanSelectedPhotosMutation: () => ({ mutate: stubs.rescan }),
}));
vi.mock("../../api_client/faces/hooks/useDetectFacesAgainMutation", () => ({
  useDetectFacesAgainMutation: () => ({ mutate: stubs.detect }),
}));
vi.mock("../../hooks/useJobQueue", () => ({ useJobQueue: () => ({ busy: stubs.busy, job: null }) }));

beforeAll(async () => {
  setUpMantineDom();
  await i18n.changeLanguage("en");
});

let root: Root | undefined;
let container: HTMLDivElement;

beforeEach(() => {
  vi.clearAllMocks();
  stubs.busy = false;
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.innerHTML = "";
});

const ME = { id: 1, username: "me", first_name: "", last_name: "" };
const BOB = { id: 2, username: "bob", first_name: "", last_name: "" };

function photo(n: number, owner = ME) {
  const id = `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  return PigPhoto.parse({ id, image_hash: `hash${n}`, aspectRatio: 1, owner });
}

async function renderInMenu(children: React.ReactNode) {
  root = createRoot(container);
  await act(async () =>
    defined(root).render(
      <MantineProvider env="test">
        <Menu opened withinPortal={false}>
          <Menu.Target>
            <button type="button">menu</button>
          </Menu.Target>
          <Menu.Dropdown>{children}</Menu.Dropdown>
        </Menu>
      </MantineProvider>
    )
  );
}

const item = (name: string) =>
  defined(
    Array.from(container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find(
      button => (button.getAttribute("aria-label") ?? button.textContent) === name
    ),
    name
  );

async function click(name: string) {
  await act(async () => item(name).click());
}

describe("FileActionItems", () => {
  it("rescans the photos and detects their faces again", async () => {
    const onDone = vi.fn<() => void>();
    await renderInMenu(<FileActionItems photoIds={["p1", "p2"]} onDone={onDone} />);

    await click("Rescan files");
    await click("Detect faces again");

    expect(stubs.rescan).toHaveBeenCalledWith(["p1", "p2"]);
    expect(stubs.detect).toHaveBeenCalledWith({ photo_ids: ["p1", "p2"] });
    expect(onDone).toHaveBeenCalledTimes(2);
  });

  it("says Rescan file for one photo, with what a rescan reads", async () => {
    await renderInMenu(<FileActionItems photoIds={["p1"]} single />);

    expect(item("Rescan file").textContent).toContain(i18n.t("fileactions.rescannote"));
  });

  it("waits for a busy queue and says so", async () => {
    stubs.busy = true;
    await renderInMenu(<FileActionItems photoIds={["p1"]} />);

    expectDisabledWithReason(item("Rescan files"), i18n.t("jobs.queuebusy.reason"));
    await click("Detect faces again");
    expect(stubs.detect).not.toHaveBeenCalled();
  });

  it("takes at most 1,000 photos", async () => {
    const ids = Array.from({ length: MAX_FILE_ACTION_PHOTOS + 1 }, (_, n) => `p${n}`);
    await renderInMenu(<FileActionItems photoIds={ids} />);

    expectDisabledWithReason(item("Rescan files"), i18n.t("fileactions.toomany"));
    await click("Rescan files");
    expect(stubs.rescan).not.toHaveBeenCalled();
  });
});

describe("SelectionFileItems", () => {
  const props = { selectAllMode: false, userId: 1, disabledReason: false as const, onDone: () => {} };

  it("sends the ids of the user's own photos only", async () => {
    await renderInMenu(<SelectionFileItems {...props} selectedItems={[photo(1), photo(2, BOB), photo(3)]} />);

    await click("Rescan files");

    expect(stubs.rescan).toHaveBeenCalledWith([photo(1).id, photo(3).id]);
  });

  it("is not shown for a selection of someone else's photos", async () => {
    await renderInMenu(<SelectionFileItems {...props} selectedItems={[photo(2, BOB)]} />);

    expect(container.querySelector('[role="menuitem"]')).toBeNull();
    expect(container.textContent).not.toContain("Files");
  });

  it("asks for the photos one by one after Select all", async () => {
    await renderInMenu(<SelectionFileItems {...props} selectAllMode selectedItems={[]} />);

    expectDisabledWithReason(item("Rescan files"), i18n.t("fileactions.selectall"));
    await click("Detect faces again");
    expect(stubs.detect).not.toHaveBeenCalled();
  });

  it("asks for a selection first", async () => {
    await renderInMenu(<SelectionFileItems {...props} disabledReason="Select first" selectedItems={[]} />);

    expectDisabledWithReason(item("Rescan files"), "Select first");
  });
});
