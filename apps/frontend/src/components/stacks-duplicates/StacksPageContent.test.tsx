/**
 * Organizing > Stacks.
 *
 * - The cards showed the server's English stack_type_display; they now use the
 *   translated stacks.typelabel.<type>, like the Duplicates tab does.
 * - Burst sequences are the only thing the detection job looks for, so with that
 *   option unchecked Detect would start a job that does nothing: it is disabled.
 */
import "@mantine/core/styles.css";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { StacksPageContent } from "./StacksPageContent";

const stubs = vi.hoisted(() => ({ detect: vi.fn() }));

vi.mock("../stacks/StackModal", () => ({ StackModal: () => null }));
vi.mock("../../api_client/stacks", () => ({
  useDeleteStackMutation: () => ({ mutate: vi.fn() }),
  useDetectStacksMutation: () => ({ mutate: stubs.detect, isPending: false }),
  useStackStatsQuery: () => ({
    data: { total_stacks: 1, by_type: { burst: 1 }, photos_in_stacks: 3, total_photos: 9 },
  }),
  useStacksQuery: () => ({
    data: {
      results: [
        {
          id: "s1",
          stack_type: "burst",
          // Deliberately not the English label, so the test sees which one is shown
          stack_type_display: "server label",
          photo_count: 3,
          preview_photos: [],
        },
      ],
      count: 1,
      num_pages: 1,
    },
    isLoading: false,
  }),
}));

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;

beforeAll(async () => {
  // @ts-ignore - jsdom has no matchMedia, MantineProvider and useMediaQuery need it
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
  // @ts-ignore
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
}, 60000);

beforeEach(async () => {
  stubs.detect.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      // env="test": no transitions or portals, so menus render in place
      <MantineProvider env="test">
        <StacksPageContent />
      </MantineProvider>
    );
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const button = (label: string) =>
  Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(el => el.textContent === label)!;
const click = async (element: HTMLElement) => {
  await act(async () => element.click());
};

describe("StacksPageContent", () => {
  it("labels a card with the translated stack type", () => {
    expect(container.textContent).toContain(i18n.t("stacks.typelabel.burst"));
    expect(container.textContent).not.toContain("server label");
  });

  it("disables Detect when there is nothing to detect", async () => {
    const detect = button(i18n.t("stacks.detect"));
    expect(detect.disabled).toBe(false);

    await click(button(i18n.t("stacks.detectOptions")));
    const bursts = container.querySelector<HTMLInputElement>("input[type=checkbox]")!;
    await click(bursts);

    expect(bursts.checked).toBe(false);
    expect(button(i18n.t("stacks.detect")).disabled).toBe(true);
  });
});
