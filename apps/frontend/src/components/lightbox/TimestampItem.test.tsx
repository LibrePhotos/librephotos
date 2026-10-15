/**
 * The date editor in the info panel stays mounted while the user browses with
 * the panel open, so its edit state has to follow the photo. It used to keep
 * the first photo's date: editing the next photo's day copied the first one's
 * time of day, and Undo wrote the first photo's old date onto the next one.
 */
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { expectDisabledWithReason } from "../common/disabledReason.test-utils";
import { TimestampItem } from "./TimestampItem";
import { createUnsavedDrafts, UnsavedDraftsContext } from "./unsavedDrafts";

type MutateCallbacks = { onSuccess?: () => void; onError?: () => void };
const updatePhoto =
  vi.fn<(variables: { id: string; data: { exif_timestamp?: string | null } }, callbacks?: MutateCallbacks) => void>();
const mutation = { isPending: false };

vi.mock("../../api_client/photos/hooks", () => ({
  useUpdatePhotoMutation: () => ({ mutate: updatePhoto, isPending: mutation.isPending }),
}));
// The hint reads the user's settings; WriteBackHint.test.tsx covers its texts (#2281).
vi.mock("./WriteBackHint", () => ({
  WriteBackHint: ({ field }: { field: string }) => <span data-write-back-hint={field} />,
}));

const PHOTO_A = { image_hash: "photoA", exif_timestamp: "2024-05-01T08:15:00+00:00" };
const PHOTO_B = { image_hash: "photoB", exif_timestamp: "2019-11-20T19:40:00+00:00" };

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
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  document.body.innerHTML = "";
  updatePhoto.mockReset();
  // The server accepts the change.
  updatePhoto.mockImplementation((_variables, callbacks) => callbacks?.onSuccess?.());
  mutation.isPending = false;
});

type TestPhoto = { image_hash: string; exif_timestamp: string | null; date_set_by_user?: boolean };

async function render(root: Root, photo: TestPhoto, isPublic = false, drafts = createUnsavedDrafts()) {
  await act(async () => {
    root.render(
      <MantineProvider>
        <UnsavedDraftsContext.Provider value={drafts}>
          <TimestampItem photoDetail={photo} isPublic={isPublic} />
        </UnsavedDraftsContext.Provider>
      </MantineProvider>
    );
  });
}

function mount() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  return { container, root: createRoot(container) };
}

function button(container: HTMLElement, label: string) {
  return container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
}

async function click(element: HTMLElement | null) {
  expect(element).toBeTruthy();
  await act(async () => {
    defined(element).click();
  });
}

function buttonWithText(container: HTMLElement, text: string) {
  return Array.from(container.querySelectorAll("button")).find(b => b.textContent === text) ?? null;
}

/** Types into the time field the way a browser reports it: "" while the value is incomplete. */
async function typeTime(container: HTMLElement, value: string) {
  const input = defined(container.querySelector<HTMLInputElement>('input[type="time"]'));
  const setValue = defined(Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set);
  await act(async () => {
    setValue.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** A day of the month shown in the open calendar. */
function dayCell(container: HTMLElement, day: string) {
  return (
    Array.from(container.querySelectorAll<HTMLButtonElement>("table button")).find(
      cell => cell.getAttribute("data-outside") !== "true" && cell.textContent === day
    ) ?? null
  );
}

describe("TimestampItem", () => {
  it("says in the editor whether the date reaches the file (#2281)", async () => {
    const { container, root } = mount();
    await render(root, PHOTO_A);
    expect(container.querySelector("[data-write-back-hint]")).toBeNull();

    await click(button(container, "Edit date and time"));
    expect(container.querySelector("[data-write-back-hint]")?.getAttribute("data-write-back-hint")).toBe("date");
  });

  it("edits the photo it is showing after the photo changes", async () => {
    const { container, root } = mount();
    await render(root, PHOTO_A);
    await render(root, PHOTO_B);

    await click(button(container, "Edit date and time"));
    const timeInput = container.querySelector<HTMLInputElement>("input");
    expect(timeInput?.value).toBe("19:40:00");

    // A new day keeps this photo's time of day.
    await click(dayCell(container, "10"));
    await click(button(container, "Save"));
    expect(updatePhoto).toHaveBeenCalledTimes(1);
    const { id, data } = defined(updatePhoto.mock.calls[0])[0];
    expect(id).toBe("photoB");
    expect(data.exif_timestamp?.slice(0, 19)).toBe("2019-11-10T19:40:00");
  });

  it("writes nothing when the date is saved unchanged", async () => {
    const { container, root } = mount();
    await render(root, PHOTO_A);

    // Save sits where the pencil was: a double-click on it must stay harmless.
    await click(button(container, "Edit date and time"));
    await click(button(container, "Save"));
    expect(updatePhoto).not.toHaveBeenCalled();
    expect(button(container, "Edit date and time")).toBeTruthy();
    expect(button(container, "Undo timestamp modification")).toBeNull();
  });

  it("keeps Undo of the last change when the date is then saved unchanged", async () => {
    const { container, root } = mount();
    await render(root, PHOTO_A);

    await click(button(container, "Edit date and time"));
    await click(dayCell(container, "10"));
    await click(button(container, "Save"));
    await click(button(container, "Edit date and time"));
    await click(button(container, "Save"));
    expect(updatePhoto).toHaveBeenCalledTimes(1);
    expect(button(container, "Undo timestamp modification")).toBeTruthy();
  });

  it("shows the date on a public share without a dead button", async () => {
    const { container, root } = mount();
    await render(root, PHOTO_B, true);

    expect(container.textContent).toContain("2019");
    expect(container.querySelector("button")).toBeNull();
  });

  it("does not offer to undo another photo's change", async () => {
    const { container, root } = mount();
    await render(root, PHOTO_A);

    // Change photo A's day, so its Undo shows up.
    await click(button(container, "Edit date and time"));
    await click(dayCell(container, "10"));
    await click(button(container, "Save"));
    expect(button(container, "Undo timestamp modification")).toBeTruthy();

    await render(root, PHOTO_B);
    expect(button(container, "Undo timestamp modification")).toBeNull();
  });

  it("opens the calendar on the photo's month, not today's", async () => {
    const { container, root } = mount();
    await render(root, PHOTO_B);

    await click(button(container, "Edit date and time"));
    expect(container.textContent).toContain("November 2019");
  });
});

describe("TimestampItem removing and saving (#2280)", () => {
  const SET_BY_USER = { ...PHOTO_A, date_set_by_user: true };
  const FROM_THE_FILE = { ...PHOTO_A, date_set_by_user: false };
  const UNDATED = { image_hash: "photoC", exif_timestamp: null, date_set_by_user: false };

  it("removes a date set by hand", async () => {
    const { container, root } = mount();
    await render(root, SET_BY_USER);

    await click(button(container, "Edit date and time"));
    await click(buttonWithText(container, "Remove timestamp"));

    expect(updatePhoto).toHaveBeenCalledTimes(1);
    expect(defined(updatePhoto.mock.calls[0])[0]).toEqual({ id: "photoA", data: { exif_timestamp: null } });
  });

  it("offers no Remove for a date read from the file or an undated photo", async () => {
    for (const photo of [FROM_THE_FILE, UNDATED]) {
      const { container, root } = mount();
      await render(root, photo);

      await click(button(container, "Edit date and time"));

      expect(buttonWithText(container, "Remove timestamp")).toBeNull();
    }
  });

  it("says when the date was set by hand", async () => {
    const { container, root } = mount();
    await render(root, SET_BY_USER);
    expect(container.textContent).toContain("Set by you");

    await render(root, FROM_THE_FILE);
    expect(container.textContent).not.toContain("Set by you");
  });

  it("keeps the editor open while the change is saved", async () => {
    updatePhoto.mockImplementation(() => {});
    const { container, root } = mount();
    await render(root, PHOTO_A);

    await click(button(container, "Edit date and time"));
    await click(dayCell(container, "10"));
    await click(button(container, "Save"));

    expect(updatePhoto).toHaveBeenCalledTimes(1);
    expect(button(container, "Save")).toBeTruthy();
    expect(button(container, "Undo timestamp modification")).toBeNull();
  });

  it("shows the saved date from the photo, not its own copy", async () => {
    const { container, root } = mount();
    await render(root, PHOTO_A);

    await click(button(container, "Edit date and time"));
    await click(dayCell(container, "10"));
    await click(button(container, "Save"));
    await render(root, { ...PHOTO_A, exif_timestamp: "2024-05-10T08:15:00+00:00", date_set_by_user: true });

    expect(button(container, "Save")).toBeNull();
    expect(container.textContent).toContain("May 10, 2024");
    expect(button(container, "Undo timestamp modification")).toBeTruthy();
  });

  it("stays open with no Undo when the save fails", async () => {
    updatePhoto.mockImplementation((_variables, callbacks) => callbacks?.onError?.());
    const { container, root } = mount();
    await render(root, PHOTO_A);

    await click(button(container, "Edit date and time"));
    await click(dayCell(container, "10"));
    await click(button(container, "Save"));

    expect(button(container, "Save")).toBeTruthy();
    expect(button(container, "Undo timestamp modification")).toBeNull();
  });

  it("does not save an empty time as midnight", async () => {
    const { container, root } = mount();
    await render(root, PHOTO_A);

    await click(button(container, "Edit date and time"));
    await typeTime(container, "");

    expectDisabledWithReason(defined(button(container, "Save")), "Invalid timestamp");
    await click(button(container, "Save"));
    expect(updatePhoto).not.toHaveBeenCalled();
  });

  it("does not turn an emptied time into midnight when a day is picked", async () => {
    const { container, root } = mount();
    await render(root, PHOTO_A);

    await click(button(container, "Edit date and time"));
    await typeTime(container, "");
    await click(dayCell(container, "10"));

    expect(container.querySelector<HTMLInputElement>('input[type="time"]')?.value).toBe("");
    expectDisabledWithReason(defined(button(container, "Save")), "Invalid timestamp");
  });

  it("starts an undated photo's new day at midnight", async () => {
    const { container, root } = mount();
    await render(root, UNDATED);

    await click(button(container, "Edit date and time"));
    await click(dayCell(container, "10"));

    expect(container.querySelector<HTMLInputElement>('input[type="time"]')?.value).toBe("00:00:00");
    expect(button(container, "Save")?.getAttribute("aria-disabled")).toBeNull();
  });

  it("keeps a time typed before the date on an undated photo", async () => {
    const { container, root } = mount();
    await render(root, UNDATED);

    await click(button(container, "Edit date and time"));
    await typeTime(container, "10:20:30");
    await click(dayCell(container, "10"));
    await click(button(container, "Save"));

    expect(updatePhoto).toHaveBeenCalledTimes(1);
    const { data } = defined(updatePhoto.mock.calls[0])[0];
    expect(data.exif_timestamp?.slice(8, 19)).toBe("10T10:20:30");
  });

  it("undoes a first correction by handing the photo back to the date rules", async () => {
    const { container, root } = mount();
    await render(root, FROM_THE_FILE);

    await click(button(container, "Edit date and time"));
    await click(dayCell(container, "10"));
    await click(button(container, "Save"));
    await click(button(container, "Undo timestamp modification"));

    expect(updatePhoto).toHaveBeenCalledTimes(2);
    expect(defined(updatePhoto.mock.calls[1])[0].data).toEqual({ exif_timestamp: null });
    expect(button(container, "Undo timestamp modification")).toBeNull();
  });
});

describe("TimestampItem's unsaved draft (#2284)", () => {
  it("is unsaved while the day or time differs from the photo's, not when the editor is only open", async () => {
    const drafts = createUnsavedDrafts();
    const { container, root } = mount();
    await render(root, PHOTO_A, false, drafts);

    await click(button(container, "Edit date and time"));
    expect(drafts.dirtyFields()).toEqual([]);
    expect(container.textContent).not.toContain("Unsaved");

    await click(dayCell(container, "10"));
    expect(drafts.dirtyFields()).toEqual(["date"]);
    expect(container.textContent).toContain("Unsaved");

    // Back to the photo's own day: nothing left to lose.
    await click(dayCell(container, "1"));
    expect(drafts.dirtyFields()).toEqual([]);

    await typeTime(container, "09:00:00");
    expect(drafts.dirtyFields()).toEqual(["date"]);
    await click(button(container, "Cancel"));
    expect(drafts.dirtyFields()).toEqual([]);
  });
});
