/**
 * The trash retention in Site settings (#2203). It deletes original files, so turning it on or
 * shortening it asks first, with the number of photos the next cleanup would delete; while it is
 * on, a red box says what it does.
 */
import type { SiteSettings, SiteSettingsUpdate, TrashRetentionPreview } from "@librephotos/api-client";
import { Grid } from "@mantine/core";
import React, { act } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { click, dialogButton, openDialog, renderInMantine, setUpMantineDom } from "../modals/confirmModal.test-utils";
import { deletesMoreThan, TrashRetentionSetting } from "./TrashRetentionSetting";

type Preview = { data?: TrashRetentionPreview; isError: boolean };

const stubs = vi.hoisted(() => ({
  save: vi.fn<(input: SiteSettingsUpdate) => void>(),
  query: { data: undefined as Partial<SiteSettings> | undefined, dataUpdatedAt: 1 },
  preview: { isError: false } as Preview,
  previewDays: [] as (number | null)[],
}));

vi.mock("../../api_client/settings/hooks", () => ({
  useGetSettingsQuery: () => stubs.query,
  useTrashRetentionPreviewQuery: (days: number | null) => {
    stubs.previewDays.push(days);
    return stubs.preview;
  },
}));
vi.mock("./useSaveSiteSettings", () => ({ useSaveSiteSettings: () => stubs.save }));

let container: HTMLElement;

async function render(stored: number) {
  stubs.query = { data: { trash_retention_days: stored }, dataUpdatedAt: 1 };
  ({ container } = await renderInMantine(
    <Grid>
      <TrashRetentionSetting />
    </Grid>
  ));
}

const field = () => defined(container.querySelector<HTMLInputElement>("input"));

async function typeAndBlur(value: string) {
  const input = field();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    input.focus();
    input.blur();
  });
}

beforeAll(async () => {
  setUpMantineDom();
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  stubs.preview = { isError: false };
  stubs.previewDays = [];
});

afterEach(() => {
  stubs.save.mockReset();
  document.body.innerHTML = "";
});

describe("deletesMoreThan", () => {
  it("is true for turning the retention on or shortening it", () => {
    expect(deletesMoreThan(0, 30)).toBe(true);
    expect(deletesMoreThan(30, 7)).toBe(true);
    expect(deletesMoreThan(7, 30)).toBe(false);
    expect(deletesMoreThan(30, 0)).toBe(false);
  });
});

describe("TrashRetentionSetting", () => {
  it("is off by default, without the warning", async () => {
    await render(0);

    expect(field().value).toBe("0 days");
    expect(container.textContent).toContain("Delete photos from the trash after");
    expect(container.textContent).not.toContain("Original files are deleted from disk");
  });

  it("warns that original files are deleted while it is on", async () => {
    await render(30);

    expect(container.textContent).toContain("Original files are deleted from disk");
    expect(container.textContent).toContain("more than 30 days are deleted together with their files");
  });

  it("asks before turning it on, with what the next cleanup deletes, and saves on confirm", async () => {
    stubs.preview = { isError: false, data: { days: 30, photo_count: 1204, user_count: 3 } };
    await render(0);

    await typeAndBlur("30");

    expect(stubs.save).not.toHaveBeenCalled();
    expect(stubs.previewDays.at(-1)).toBe(30);
    const text = openDialog()?.textContent ?? "";
    expect(text).toContain("Delete old photos from the trash automatically?");
    expect(text).toContain("more than 30 days will be deleted for good, with their original files");
    expect(text).toContain("Right now that is 1204 photos (in the trash of 3 users)");

    await click(dialogButton("Delete automatically"));
    expect(stubs.save).toHaveBeenCalledWith({ trash_retention_days: 30 });
  });

  it("puts the stored value back when the admin backs out", async () => {
    stubs.preview = { isError: false, data: { days: 7, photo_count: 0, user_count: 0 } };
    await render(30);

    await typeAndBlur("7");
    expect(openDialog()?.textContent).toContain("no photo has been in a trash that long");
    await click(dialogButton("Cancel"));

    expect(stubs.save).not.toHaveBeenCalled();
    expect(field().value).toBe("30 days");
  });

  it("says when it is still counting or cannot count", async () => {
    await render(0);
    await typeAndBlur("14");
    expect(openDialog()?.textContent).toContain("Counting the photos this would delete");
    await click(dialogButton("Cancel"));

    stubs.preview = { isError: true };
    await typeAndBlur("14");
    expect(openDialog()?.textContent).toContain("could not be counted");
  });

  it("saves lengthening it or turning it off without asking", async () => {
    await render(30);

    await typeAndBlur("60");
    expect(stubs.save).toHaveBeenLastCalledWith({ trash_retention_days: 60 });
    await typeAndBlur("0");
    expect(stubs.save).toHaveBeenLastCalledWith({ trash_retention_days: 0 });
    expect(openDialog()).toBeNull();
  });

  it("keeps an unchanged or emptied field from saving", async () => {
    await render(30);

    await typeAndBlur("30");
    await typeAndBlur("");

    expect(stubs.save).not.toHaveBeenCalled();
    expect(field().value).toBe("30 days");
  });
});
