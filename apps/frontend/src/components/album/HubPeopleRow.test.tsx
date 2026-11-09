/**
 * The album hub's People row: one row of as many cards as fit on a wide screen; on a phone a strip
 * that scrolls sideways through more people, as Google Photos' People row does.
 */
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Person } from "../../api_client/albums/hooks";
import "../../i18n";
import { HubPeopleRow } from "./HubPeopleRow";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}));
vi.mock("./PersonCard", () => ({
  PersonCard: ({ person, size }: { person: { name: string }; size: number }) => (
    <div data-testid="person" data-size={size}>
      {person.name}
    </div>
  ),
}));

beforeAll(() => {
  // jsdom has no ResizeObserver; the row measures its width with one
  globalThis.ResizeObserver = class {
    observe() {}

    unobserve() {}

    disconnect() {}
  };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | undefined;
let container: HTMLDivElement;

/** Every media query matches (a phone) or none does. */
function setPhone(phone: boolean) {
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: phone,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

const people: Person[] = Array.from({ length: 20 }, (_, i) => ({
  id: i + 1,
  name: `Person ${i + 1}`,
  face_url: null,
  face_count: 3,
  face_photo_url: null,
}));

function render() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      <MantineProvider>
        <HubPeopleRow people={people} isLoading={false} />
      </MantineProvider>
    )
  );
  return [...container.querySelectorAll<HTMLElement>('[data-testid="person"]')];
}

afterEach(() => {
  act(() => root?.unmount());
  container.remove();
});

describe("HubPeopleRow", () => {
  it("swipes through fifteen people on a phone, at a fixed card width", () => {
    setPhone(true);
    const cards = render();
    expect(cards).toHaveLength(15);
    expect(cards.every(card => card.dataset.size === "104")).toBe(true);
  });

  it("keeps to the one row that fits on a wide screen", () => {
    setPhone(false);
    // jsdom measures no width, so no column fits: the row is empty rather than overflowing
    expect(render()).toHaveLength(0);
  });
});
