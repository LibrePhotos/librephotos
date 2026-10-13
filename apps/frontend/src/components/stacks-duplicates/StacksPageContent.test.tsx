/**
 * Organizing > Stacks.
 *
 * - The cards showed the server's English stack_type_display; they now use the
 *   translated stacks.typelabel.<type>, like the Duplicates tab does.
 * - Burst sequences are the only thing the detection job looks for, so with that
 *   option unchecked Detect would start a job that does nothing: it is disabled.
 * - Unstack acted on one click (#2223); a manual stack is then gone for good.
 */
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { expectDisabledWithReason, focusAndReadTooltip } from "../common/disabledReason.test-utils";
import { StacksPageContent } from "./StacksPageContent";

const stubs = vi.hoisted(() => ({
  detect: vi.fn<(options: { detect_bursts: boolean }) => void>(),
  deleteStack: vi.fn<(id: string, options?: { onSuccess?: () => void }) => void>(),
  stackType: "burst",
}));

vi.mock("../stacks/StackModal", () => ({ StackModal: () => null }));
vi.mock("../../api_client/stacks", () => ({
  useDeleteStackMutation: () => ({ mutate: stubs.deleteStack, isPending: false }),
  useDetectStacksMutation: () => ({ mutate: stubs.detect, isPending: false }),
  useStackStatsQuery: () => ({
    data: { total_stacks: 1, by_type: { burst: 1 }, photos_in_stacks: 3, total_photos: 9 },
  }),
  useStacksQuery: () => ({
    data: {
      results: [
        {
          id: "s1",
          stack_type: stubs.stackType,
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
  // jsdom has no matchMedia, MantineProvider and useMediaQuery need it
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
}, 60000);

async function renderPage() {
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
}

beforeEach(async () => {
  stubs.detect.mockReset();
  stubs.deleteStack.mockReset();
  stubs.stackType = "burst";
  await renderPage();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

/** The element a test goes on to use: missing, the test fails here and says what was missing. */
function rendered<T>(element: T | null | undefined, what: string): T {
  if (element === null || element === undefined) throw new Error(`${what} is not rendered`);
  return element;
}

const button = (label: string) =>
  rendered(
    Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(el => el.textContent === label),
    `the ${label} button`
  );
const click = async (element: HTMLElement) => {
  await act(async () => element.click());
};

describe("StacksPageContent", () => {
  it("labels a card with the translated stack type", () => {
    expect(container.textContent).toContain(i18n.t("stacks.typelabel.burst"));
    expect(container.textContent).not.toContain("server label");
  });

  it("disables Detect when there is nothing to detect, and says why (#2237)", async () => {
    const detect = button(i18n.t("stacks.detect"));
    expect(detect.getAttribute("aria-disabled")).toBeNull();

    await click(button(i18n.t("stacks.detectOptions")));
    const bursts = rendered(container.querySelector<HTMLInputElement>("input[type=checkbox]"), "the bursts option");
    await click(bursts);

    expect(bursts.checked).toBe(false);
    const disabled = button(i18n.t("stacks.detect"));
    expectDisabledWithReason(disabled, i18n.t("stacks.nothingtodetect"));
    expect(await focusAndReadTooltip(disabled)).toContain(i18n.t("stacks.nothingtodetect"));
    await click(disabled);
    expect(stubs.detect).not.toHaveBeenCalled();
  });

  describe("Unstack", () => {
    const dialog = () => document.querySelector('[role="dialog"]');
    const askToUnstack = async () => {
      await click(
        rendered(container.querySelector<HTMLElement>(`[aria-label="${i18n.t("moreactions")}"]`), "the menu")
      );
      await click(button(i18n.t("stacks.unstack")));
    };

    it("asks first and unstacks nothing yet", async () => {
      await askToUnstack();

      expect(dialog()?.textContent).toContain(
        "The 3 photos stay in your library. Detect Photo Stacks can group them again."
      );
      expect(stubs.deleteStack).not.toHaveBeenCalled();
    });

    it("unstacks once confirmed", async () => {
      await askToUnstack();

      await click(button(i18n.t("confirmdialog.unstack.confirm")));

      expect(stubs.deleteStack).toHaveBeenCalledWith("s1", expect.anything());
    });

    it("keeps the stack on Cancel", async () => {
      await askToUnstack();

      await click(button(i18n.t("cancel")));

      expect(stubs.deleteStack).not.toHaveBeenCalled();
    });

    it("warns that a manual stack has to be built again by hand", async () => {
      await act(async () => root.unmount());
      container.remove();
      stubs.stackType = "manual";
      await renderPage();

      await askToUnstack();

      expect(dialog()?.textContent).toContain("has to be built again by hand");
      expect(dialog()?.textContent).toContain(i18n.t("confirmdialog.cannotbeundone"));
    });
  });
});
