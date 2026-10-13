/**
 * Section navigation on /settings and /admin (#2226): one entry per card, a click scrolls to the
 * card and puts its id in the URL, a link with a hash scrolls to its card once the page has loaded,
 * and the "#" after a card title copies a link to it.
 */
import { MantineProvider, Title } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { defined } from "../../util/defined.test-utils";
import { SectionNav } from "./SectionNav";
import { SectionLink, SettingsSection } from "./SettingsSection";

type NavigateOptions = { hash?: string; replace?: boolean; resetScroll?: boolean };

const mocks = vi.hoisted(() => ({
  hash: "",
  navigate: vi.fn<(options: NavigateOptions) => Promise<void>>(),
  copy: vi.fn<(text: string) => void>(),
  success: vi.fn<(message: string) => void>(),
  fetching: 0,
}));

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
  useLocation: ({ select }: { select: (location: { hash: string }) => string }) => select({ hash: mocks.hash }),
}));
vi.mock("@tanstack/react-query", async importOriginal => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useIsFetching: () => mocks.fetching,
}));
vi.mock("../../service/notifications", () => ({ notification: { success: mocks.success } }));
vi.mock("../../util/util", () => ({ copyToClipboard: mocks.copy }));

const SECTIONS = [
  { id: "test-first", label: "First card" },
  { id: "test-second", label: "Second card" },
  { id: "test-third", label: "Third card" },
];

const scrolled = vi.fn<(id: string) => void>();
// Where each section's top is in the viewport; jsdom puts everything at 0.
const tops = new Map<string, number>();

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
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
  globalThis.ResizeObserver = class ResizeObserverStub implements ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  // jsdom does not lay out or scroll.
  HTMLElement.prototype.scrollIntoView = function scrollIntoView(this: HTMLElement) {
    scrolled(this.id);
  };
  const boundingRect = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect(this: HTMLElement) {
    const top = tops.get(this.id);
    return top === undefined ? boundingRect.call(this) : new DOMRect(0, top, 100, 100);
  };
});

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  mocks.hash = "";
  mocks.fetching = 0;
  mocks.navigate.mockReset();
  mocks.navigate.mockResolvedValue(undefined);
  mocks.copy.mockReset();
  mocks.success.mockReset();
  scrolled.mockReset();
  tops.clear();
  for (const [index, { id }] of SECTIONS.entries()) {
    tops.set(id, 100 + index * 600);
  }
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

function page() {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <MantineProvider>
        <SectionNav sections={SECTIONS}>
          {SECTIONS.map(({ id, label }) => (
            <SettingsSection key={id} id={id}>
              <Title order={4}>
                {label}
                <SectionLink />
              </Title>
            </SettingsSection>
          ))}
        </SectionNav>
      </MantineProvider>
    </QueryClientProvider>
  );
}

async function render() {
  await act(async () => {
    root.render(page());
  });
}

const navs = () => [...container.querySelectorAll("nav")];
const linksIn = (nav: Element) => [...nav.querySelectorAll<HTMLAnchorElement>("a")];

describe("SectionNav", () => {
  it("lists every section once in the table of contents and once in the chip row", async () => {
    await render();

    expect(navs()).toHaveLength(2);
    for (const nav of navs()) {
      expect(nav.getAttribute("aria-label")).toBe("sectionnav.onthispage");
      expect(linksIn(nav).map(link => link.getAttribute("href"))).toEqual([
        "#test-first",
        "#test-second",
        "#test-third",
      ]);
      expect(linksIn(nav).map(link => link.textContent)).toEqual(["First card", "Second card", "Third card"]);
    }
  });

  it("gives every section its id and marks the first one current at the top of the page", async () => {
    await render();

    for (const { id } of SECTIONS) {
      expect(document.getElementById(id)?.tagName).toBe("SECTION");
    }
    for (const nav of navs()) {
      expect(linksIn(nav).map(link => link.getAttribute("aria-current"))).toEqual(["location", null, null]);
    }
  });

  it("marks the section that has scrolled under the top bar current", async () => {
    await render();

    tops.set("test-first", -900);
    tops.set("test-second", -300);
    tops.set("test-third", 300);
    await act(async () => {
      window.dispatchEvent(new Event("scroll"));
      await new Promise(resolve => window.requestAnimationFrame(resolve));
    });

    for (const nav of navs()) {
      expect(linksIn(nav).map(link => link.getAttribute("aria-current"))).toEqual([null, "location", null]);
    }
  });

  it("scrolls to the picked section and puts its id in the URL without a history entry", async () => {
    await render();

    const entry = defined(linksIn(defined(navs()[1], "the table of contents"))[1], "the second entry");
    await act(async () => {
      entry.click();
    });

    expect(scrolled).toHaveBeenCalledWith("test-second");
    expect(document.activeElement?.id).toBe("test-second");
    expect(mocks.navigate).toHaveBeenCalledWith(
      expect.objectContaining({ hash: "test-second", replace: true, resetScroll: false })
    );
  });

  it("scrolls to the section in the URL hash once the page has loaded", async () => {
    mocks.hash = "test-third";
    mocks.fetching = 1;
    await render();
    expect(scrolled).not.toHaveBeenCalled();

    mocks.fetching = 0;
    await render();
    expect(scrolled).toHaveBeenCalledWith("test-third");

    // A refetch later does not scroll the page back.
    mocks.fetching = 1;
    await render();
    mocks.fetching = 0;
    await render();
    expect(scrolled).toHaveBeenCalledTimes(1);
  });

  it("scrolls anyway when a first load takes long", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      mocks.hash = "test-second";
      mocks.fetching = 1;
      await render();
      expect(scrolled).not.toHaveBeenCalled();

      await act(async () => {
        vi.advanceTimersByTime(1500);
      });
      expect(scrolled).toHaveBeenCalledWith("test-second");
    } finally {
      vi.useRealTimers();
    }
  });

  it("stays at the top for a hash that is not a section", async () => {
    mocks.hash = "settings-albums";
    await render();

    expect(scrolled).not.toHaveBeenCalled();
  });

  it("copies a link to the section from the # after its title", async () => {
    await render();

    const link = defined(
      container.querySelector<HTMLAnchorElement>('#test-second a[aria-label="sectionnav.copylink"]'),
      "the copy link"
    );
    await act(async () => {
      link.click();
    });

    expect(mocks.copy).toHaveBeenCalledWith(expect.stringMatching(/#test-second$/));
    expect(mocks.success).toHaveBeenCalledWith("sectionnav.linkcopied");
    expect(mocks.navigate).toHaveBeenCalledWith(expect.objectContaining({ hash: "test-second" }));
  });

  it("shows no # link outside a page with section navigation", async () => {
    await act(async () => {
      root.render(
        <MantineProvider>
          <SettingsSection id="lonely">
            <Title order={4}>
              Lonely
              <SectionLink />
            </Title>
          </SettingsSection>
        </MantineProvider>
      );
    });

    expect(container.querySelector("a")).toBeNull();
  });
});
