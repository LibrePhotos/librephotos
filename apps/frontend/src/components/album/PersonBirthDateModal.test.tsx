/**
 * The birth date dialog of the person page (#2750): it opens on the saved date, saves the date
 * picked (Enter too), removes it, refuses a day in the future, and warns when photos of the
 * person are older than the date. It closes only once the server took the change.
 */
import { Media, type DatePhotosGroup, type PigPhoto } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import { DatesProvider } from "@mantine/dates";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { useSetPersonBirthDateMutation } from "../../api_client/albums/hooks";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { PersonBirthDateModal } from "./PersonBirthDateModal";
import { makePersonBirthDateSchema } from "./PersonBirthDateModal.schema";

type SetBirthDate = ReturnType<typeof useSetPersonBirthDateMutation>["mutate"];

const stubs = vi.hoisted(() => ({ setBirthDate: vi.fn<SetBirthDate>() }));

vi.mock("../../api_client/albums/hooks", () => ({
  useSetPersonBirthDateMutation: () => ({ mutate: stubs.setBirthDate, isPending: false }),
}));

const tile = (id: string): PigPhoto => ({
  id,
  image_hash: id,
  aspectRatio: 1,
  type: Media.IMAGE,
  is_hdr: false,
  rating: 0,
  shared_to: [],
  isTemp: false,
  has_raw_variant: false,
});
const groups: DatePhotosGroup[] = [
  { date: "2025-06-14T10:00:00Z", location: null, items: [tile("a")] },
  { date: "2018-02-12T10:00:00Z", location: null, items: [tile("b"), tile("c")] },
];
const onClose = vi.fn<() => void>();

let root: Root;
let container: HTMLDivElement;

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
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function renderDialog(birthDate: string | null) {
  await act(async () => {
    root.render(
      // env="test": no transitions or portals, so the dialog renders in place
      <MantineProvider env="test">
        <DatesProvider settings={{ locale: "en" }}>
          <PersonBirthDateModal
            opened
            onClose={onClose}
            person={{ id: "5", name: "Mia", birth_date: birthDate }}
            groups={groups}
          />
        </DatesProvider>
      </MantineProvider>
    );
  });
}

const input = () => defined(container.querySelector<HTMLInputElement>("input"), "the date input");
const button = (text: string) =>
  defined(
    Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(el => el.textContent === text),
    `the ${text} button`
  );
// React tracks the previous value on the node itself, so a plain assignment is swallowed.
const setInputValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;

async function type(value: string) {
  await act(async () => {
    setInputValue?.call(input(), value);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function submit() {
  const form = defined(container.querySelector("form"), "the form");
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

describe("PersonBirthDateModal", () => {
  it("names the person and says who sees the date", async () => {
    await renderDialog(null);

    expect(container.textContent).toContain("Birth date of Mia");
    expect(container.textContent).toContain("Only you see it.");
    // Nothing to remove yet
    expect(Array.from(container.querySelectorAll("button")).map(el => el.textContent)).not.toContain(
      "Remove birth date"
    );
  });

  it("saves the date typed, and closes once the server took it", async () => {
    await renderDialog(null);

    await type("May 3, 2019");
    await submit();

    expect(stubs.setBirthDate).toHaveBeenCalledWith(
      { id: "5", name: "Mia", birthDate: "2019-05-03" },
      { onSuccess: onClose }
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it("opens on the saved date and saves it unchanged with Enter", async () => {
    await renderDialog("2019-05-03");

    expect(input().value).toBe("May 3, 2019");
    await submit();

    expect(stubs.setBirthDate).toHaveBeenCalledWith(
      { id: "5", name: "Mia", birthDate: "2019-05-03" },
      expect.anything()
    );
  });

  it("removes the date", async () => {
    await renderDialog("2019-05-03");

    await act(async () => button("Remove birth date").click());

    expect(stubs.setBirthDate).toHaveBeenCalledWith({ id: "5", name: "Mia", birthDate: null }, { onSuccess: onClose });
  });

  it("warns how many photos of the person are older than the date", async () => {
    await renderDialog("2019-05-03");

    expect(container.textContent).toContain("2 photos of Mia are older.");
  });

  it("does not warn when no photo is older", async () => {
    await renderDialog("2010-01-01");

    expect(container.textContent).not.toContain("are older");
  });

  it("closes on Cancel without saving", async () => {
    await renderDialog("2019-05-03");

    await act(async () => button("Cancel").click());

    expect(onClose).toHaveBeenCalled();
    expect(stubs.setBirthDate).not.toHaveBeenCalled();
  });
});

describe("the birth date schema", () => {
  const schema = makePersonBirthDateSchema(i18n.t, "2026-10-22");

  it("takes a day up to today, or none", () => {
    expect(schema.safeParse({ birthDate: "2026-10-22" }).success).toBe(true);
    expect(schema.safeParse({ birthDate: null }).success).toBe(true);
  });

  it("refuses a day in the future", () => {
    const result = schema.safeParse({ birthDate: "2026-10-23" });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("The birth date can't be in the future.");
  });
});
