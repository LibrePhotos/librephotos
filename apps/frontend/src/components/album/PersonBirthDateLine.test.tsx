/**
 * The birth date line under a person's name (#2751) and the page state behind it: the line says
 * the date and the age today, a click opens the dialog, and closing it puts the focus back on the
 * control it was opened from.
 */
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { PersonBirthDateLine } from "./PersonBirthDateLine";
import { usePersonBirthDate } from "./usePersonBirthDate";

let root: Root;
let container: HTMLDivElement;
let state: ReturnType<typeof usePersonBirthDate> | undefined;

function Harness({ birthDate }: Readonly<{ birthDate: string }>) {
  state = usePersonBirthDate({ birth_date: birthDate });
  return (
    <MantineProvider env="test">
      <PersonBirthDateLine name="Mia" birthDate={birthDate} onEdit={state.openFrom} />
      <button type="button">elsewhere</button>
    </MantineProvider>
  );
}

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
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2025, 5, 14, 12));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  state = undefined;
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});

const line = () => defined(container.querySelector<HTMLButtonElement>("button"), "the birth date line");

describe("PersonBirthDateLine", () => {
  it("says the birth date and the age today", async () => {
    await act(async () => root.render(<Harness birthDate="2019-05-03" />));

    expect(line().textContent).toBe("Born May 3, 2019 · 6 years old");
    expect(line().title).toBe("Edit the birth date of Mia");
  });

  it("says only the date when the birth is after today", async () => {
    await act(async () => root.render(<Harness birthDate="2025-07-01" />));

    expect(line().textContent).toBe("Born Jul 1, 2025");
  });

  it("opens the dialog, and its close puts the focus back on the line", async () => {
    await act(async () => root.render(<Harness birthDate="2019-05-03" />));

    await act(async () => line().click());
    expect(defined(state).opened).toBe(true);
    defined(container.querySelectorAll<HTMLButtonElement>("button")[1]).focus();

    await act(async () => defined(state).close());

    expect(defined(state).opened).toBe(false);
    expect(document.activeElement).toBe(line());
  });
});
