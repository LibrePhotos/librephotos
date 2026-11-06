/**
 * Empty trash on the trash page (#2203), in its header's ⋯: the count is the whole trash from the
 * server, the confirmation names it and the files on disk, and only its red button starts the job.
 */
import React, { act } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { click, dialogButton, openDialog, renderInMantine, setUpMantineDom } from "../modals/confirmModal.test-utils";
import { TrashHeaderMenu } from "./TrashHeaderMenu";

type MutateOptions = { onSuccess?: (jobId: string) => void };

const stubs = vi.hoisted(() => ({
  groups: [] as { numberOfItems: number }[] | undefined,
  mutate: vi.fn<(count: number, options?: MutateOptions) => void>(),
  followed: [] as (string | null)[],
  listOptions: [] as unknown[],
}));

vi.mock("../../api_client/albums/hooks", () => ({
  useFetchDateAlbumsQuery: (options: unknown) => {
    stubs.listOptions.push(options);
    return { data: stubs.groups };
  },
}));
vi.mock("../../api_client/photos/hooks", () => ({
  useEmptyTrashMutation: () => ({ mutate: stubs.mutate, isPending: false }),
  useFollowEmptyTrashJob: (jobId: string | null) => {
    stubs.followed.push(jobId);
    return undefined;
  },
}));

beforeAll(async () => {
  setUpMantineDom();
  await i18n.changeLanguage("en");
});

afterEach(() => {
  document.body.innerHTML = "";
  stubs.groups = [];
  stubs.mutate.mockReset();
  stubs.followed = [];
  stubs.listOptions = [];
});

/** Opens the ⋯ and returns its item whose text holds `text`. */
async function menuItem(container: HTMLElement, text: string): Promise<HTMLButtonElement> {
  const more = container.querySelector<HTMLButtonElement>(`button[aria-label="${i18n.t("trash.actions")}"]`);
  await click(defined(more, "the ⋯"));
  // let the menu's open transition mount the dropdown
  await act(async () => new Promise(resolve => setTimeout(resolve, 50)));
  return defined(
    [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(item =>
      item.textContent?.includes(text)
    )
  );
}

describe("TrashHeaderMenu", () => {
  it("counts the whole trash, not what the media filter shows", async () => {
    stubs.groups = [{ numberOfItems: 300 }, { numberOfItems: 12 }];
    const { container } = await renderInMantine(<TrashHeaderMenu shownCount={41} />);

    expect(stubs.listOptions.at(-1)).toMatchObject({ photosetType: "in_trashcan", mediaType: "all" });
    await click(await menuItem(container, "Empty trash"));

    const text = openDialog()?.textContent ?? "";
    expect(text).toContain("Empty the trash?");
    expect(text).toContain("All 312 photos and videos in the trash are deleted for good");
    expect(text).toContain("together with their original files on disk");
    expect(text).toContain("This includes the 271 that the media filter hides.");
    expect(text).toContain("follow it in the job list");
    expect(text).toContain("This action cannot be undone.");
  });

  it("starts the job only from the red button of the dialog, then follows it", async () => {
    stubs.groups = [{ numberOfItems: 5 }];
    const { container } = await renderInMantine(<TrashHeaderMenu shownCount={5} />);
    await click(await menuItem(container, "Empty trash"));
    expect(openDialog()?.textContent).not.toContain("media filter");

    await click(dialogButton("Cancel"));
    expect(stubs.mutate).not.toHaveBeenCalled();

    stubs.mutate.mockImplementation((_count, options) => options?.onSuccess?.("job-uuid"));
    await click(await menuItem(container, "Empty trash"));
    await click(dialogButton("Empty trash"));

    expect(stubs.mutate).toHaveBeenCalledWith(5, expect.anything());
    expect(stubs.followed.at(-1)).toBe("job-uuid");
    // While the job runs the item says so and cannot start a second one.
    expect((await menuItem(container, "Emptying the trash")).getAttribute("aria-disabled")).toBe("true");
  });

  it("is not there while the trash is empty or loading", async () => {
    for (const groups of [[], undefined]) {
      stubs.groups = groups;
      const { container } = await renderInMantine(<TrashHeaderMenu shownCount={0} />);
      expect(container.querySelector("button")).toBeNull();
    }
  });
});
