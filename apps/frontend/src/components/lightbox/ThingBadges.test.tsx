/** #2744: the lightbox shows things in the interface language and still searches for the English word. */
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { ThingBadges } from "./ThingBadges";

const navigate = vi.hoisted(() => vi.fn<(options: { to: string }) => void>());
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));

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
  i18n.addResourceBundle("de", "tags", { beach: "Strand", "st. patrick's day": "St. Patrick's Day" });
  await i18n.changeLanguage("de");
});

afterAll(async () => {
  i18n.removeResourceBundle("de", "tags");
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  navigate.mockReset();
});

async function render(props: Partial<React.ComponentProps<typeof ThingBadges>> = {}) {
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <MantineProvider>
        <ThingBadges
          things={["beach", "kayak", "st. patrick's day"]}
          imageHash="a"
          isPublic={false}
          inCard
          {...props}
        />
      </MantineProvider>
    )
  );
  const badges = [...container.querySelectorAll<HTMLElement>(".mantine-Badge-root")];
  return { container, badges };
}

describe("ThingBadges in another language", () => {
  it("names each thing in the interface language, with its English word as the tooltip", async () => {
    const { badges } = await render();

    expect(badges.map(badge => badge.textContent)).toEqual(["Strand", "kayak", "St. Patrick's Day"]);
    expect(badges.map(badge => badge.getAttribute("title"))).toEqual(["beach", null, "st. patrick's day"]);
  });

  it("searches for the stored English word", async () => {
    const { badges } = await render();

    await act(async () => badges[0]?.click());
    expect(navigate).toHaveBeenCalledWith({ to: "/search/beach" });
  });

  it("labels a public page's things without a search", async () => {
    const { badges } = await render({ isPublic: true });

    expect(badges.map(badge => badge.tagName)).toEqual(["DIV", "DIV", "DIV"]);
    expect(badges[0]?.textContent).toBe("Strand");
    await act(async () => badges[0]?.click());
    expect(navigate).not.toHaveBeenCalled();
  });

  it("shows its own heading outside a card", async () => {
    const { container } = await render({ inCard: false });

    expect(container.querySelector("h4")?.textContent).toBe(i18n.t("things"));
  });
});
