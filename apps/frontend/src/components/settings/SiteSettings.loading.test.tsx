/**
 * The site settings card before its settings have loaded (#2224).
 *
 * The switches started "off" and were live while the request was still out. Each one saves the
 * negation of what it shows, so turning registration off on a slow connection sent
 * `allow_registration: true` and left registration open. A failed request showed every switch
 * "off" whatever the server had. The loaded card is covered in SiteSettings.test.tsx.
 */
import type { SiteSettings as SiteSettingsValues } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { SiteSettings } from "./SiteSettings";

type QueryState = {
  data: SiteSettingsValues | undefined;
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
  dataUpdatedAt: number;
  refetch: () => Promise<unknown>;
};

const stubs = vi.hoisted(() => ({
  save: vi.fn<(input: Partial<SiteSettingsValues>) => void>(),
  refetch: vi.fn<() => Promise<unknown>>(async () => undefined),
  query: undefined as QueryState | undefined,
}));

vi.mock("../../api_client/settings/hooks", () => ({ useGetSettingsQuery: () => stubs.query }));
vi.mock("./useSaveSiteSettings", () => ({ useSaveSiteSettings: () => stubs.save }));

const pending = (): QueryState => ({
  data: undefined,
  isLoading: true,
  isError: false,
  isFetching: true,
  dataUpdatedAt: 0,
  refetch: stubs.refetch,
});

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;

beforeAll(async () => {
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
  stubs.save.mockReset();
  stubs.refetch.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render(query: QueryState) {
  stubs.query = query;
  await act(async () => {
    root.render(
      <MantineProvider env="test">
        <SiteSettings />
      </MantineProvider>
    );
  });
}

const switches = () => [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];

describe("SiteSettings while the settings load", () => {
  it("offers no switch to click and saves nothing", async () => {
    await render(pending());

    for (const input of switches()) {
      await act(async () => input.click());
    }

    expect(stubs.save).not.toHaveBeenCalled();
    expect(switches()).toHaveLength(0);
    expect(container.querySelector('[role="status"]')).not.toBeNull();
  });

  it("shows an error with Retry instead of every switch off when the request failed", async () => {
    await render({ ...pending(), isLoading: false, isError: true, isFetching: false });

    expect(switches()).toHaveLength(0);
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain(i18n.t("errorstate.title"));
    const retry = [...container.querySelectorAll("button")].find(b => b.textContent === i18n.t("errorstate.retry"));
    await act(async () => retry?.click());
    expect(stubs.refetch).toHaveBeenCalled();
  });
});
