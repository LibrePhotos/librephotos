/**
 * The date editor in the info panel stays mounted while the user browses with
 * the panel open, so its edit state has to follow the photo. It used to keep
 * the first photo's date: editing the next photo's day copied the first one's
 * time of day, and Undo wrote the first photo's old date onto the next one.
 */
import "@mantine/core/styles.css";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { TimestampItem } from "./TimestampItem";

const updatePhoto = vi.fn<(variables: { id: string; data: { exif_timestamp?: string | null } }) => void>();

vi.mock("../../api_client/photos/hooks", () => ({
  useUpdatePhotoMutation: () => ({ mutate: updatePhoto }),
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
});

async function render(root: Root, photo: { image_hash: string; exif_timestamp: string }, isPublic = false) {
  await act(async () => {
    root.render(
      <MantineProvider>
        <TimestampItem photoDetail={photo} isPublic={isPublic} />
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

/** A day of the month shown in the open calendar. */
function dayCell(container: HTMLElement, day: string) {
  return (
    Array.from(container.querySelectorAll<HTMLButtonElement>("table button")).find(
      cell => cell.getAttribute("data-outside") !== "true" && cell.textContent === day
    ) ?? null
  );
}

describe("TimestampItem", () => {
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
    const { id, data } = updatePhoto.mock.calls[0][0];
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
