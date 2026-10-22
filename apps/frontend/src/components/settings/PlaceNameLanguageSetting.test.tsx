/** #2745: the place-name language in Site settings, and the offer to look place names up again. */
import type { SiteSettingsUpdate } from "@librephotos/api-client";
import { Grid, MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { PlaceNameLanguageSetting } from "./PlaceNameLanguageSetting";

type LookUpOptions = { onSuccess?: () => void; onSettled?: () => void };

const mocks = vi.hoisted(() => ({
  save: vi.fn<(input: SiteSettingsUpdate) => void>(),
  lookUpPlaces: vi.fn<(variables: undefined, options: LookUpOptions) => void>(),
  settingsQuery: { dataUpdatedAt: 1, data: { geocode_language: "" } },
}));

vi.mock("../../api_client/settings/hooks", () => ({ useGetSettingsQuery: () => mocks.settingsQuery }));
vi.mock("../../api_client/jobs/hooks", () => ({
  useLookUpPlacesMutation: () => ({ mutate: mocks.lookUpPlaces, isPending: false }),
}));
vi.mock("./useSaveSiteSettings", () => ({ useSaveSiteSettings: () => mocks.save }));

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
  // jsdom has no ResizeObserver, the Select's dropdown needs it
  globalThis.ResizeObserver = class {
    observe() {}

    unobserve() {}

    disconnect() {}
  };
  Element.prototype.scrollIntoView = () => {};
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.settingsQuery = { dataUpdatedAt: 1, data: { geocode_language: "" } };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render(supported = true) {
  await act(async () => {
    root.render(
      // env="test": no transitions or portals, so the dropdown and the dialog render in place
      <MantineProvider env="test">
        <Grid>
          <PlaceNameLanguageSetting providerLabel="Mapbox" supported={supported} />
        </Grid>
      </MantineProvider>
    );
  });
}

/** The server now stores `language`, as the settings query would bring back after a save. */
async function serverStores(language: string) {
  mocks.settingsQuery = { dataUpdatedAt: mocks.settingsQuery.dataUpdatedAt + 1, data: { geocode_language: language } };
  await render();
}

const select = () => defined(container.querySelector<HTMLInputElement>("input"), "the language select");
const button = (label: string) =>
  defined(
    [...container.querySelectorAll<HTMLButtonElement>("button")].find(el => el.textContent === label),
    `the ${label} button`
  );

async function choose(label: string) {
  await act(async () => select().click());
  const option = defined(
    [...container.querySelectorAll<HTMLElement>('[role="option"]')].find(el => el.textContent === label),
    `the ${label} option`
  );
  await act(async () => option.click());
}

async function type(text: string) {
  // Focused: Mantine takes a change to an input without focus for autofill and ignores the text
  await act(async () => {
    select().focus();
    select().click();
  });
  const setValue = defined(Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set);
  await act(async () => {
    setValue.call(select(), text);
    select().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("PlaceNameLanguageSetting", () => {
  it("shows the provider's default when nothing is set", async () => {
    await render();
    expect(select().value).toBe("Provider default");
    expect(container.textContent).not.toContain("New lookups");
  });

  it("saves a language and then offers to look the place names up again", async () => {
    await render();
    await choose("German (de)");
    expect(mocks.save).toHaveBeenCalledWith({ geocode_language: "de" });
    // Not before the server has it: a refused save shows no alert
    expect(container.textContent).not.toContain("New lookups");

    await serverStores("de");
    expect(container.textContent).toContain("New lookups name places in German");

    await act(async () => button("Look up place names again…").click());
    await act(async () => button("Look up").click());
    const options = defined(mocks.lookUpPlaces.mock.calls[0])[1];
    await act(async () => options.onSuccess?.());
    expect(container.textContent).not.toContain("New lookups");
  });

  it("can put the lookup off", async () => {
    await render();
    await choose("German (de)");
    await serverStores("de");

    await act(async () => button("Later").click());
    expect(container.textContent).not.toContain("New lookups");
    expect(mocks.lookUpPlaces).not.toHaveBeenCalled();
  });

  it("goes back to the provider's default as an empty value", async () => {
    mocks.settingsQuery.data.geocode_language = "de";
    await render();
    await choose("Provider default");
    expect(mocks.save).toHaveBeenCalledWith({ geocode_language: "" });

    await serverStores("");
    expect(container.textContent).toContain("the provider's default language");
  });

  it("takes a typed code no language has, such as Nominatim's list", async () => {
    await render();
    await type("de,en");
    await act(async () => {
      defined(
        [...container.querySelectorAll<HTMLElement>('[role="option"]')].find(el => el.textContent === "de,en"),
        "the typed code"
      ).click();
    });
    expect(mocks.save).toHaveBeenCalledWith({ geocode_language: "de,en" });
  });

  it("keeps a stored list it has no name for", async () => {
    mocks.settingsQuery.data.geocode_language = "de,en";
    await render();
    expect(select().value).toBe("de,en");
  });

  it("says why it does nothing with a provider that cannot be asked", async () => {
    await render(false);
    expect(select().disabled).toBe(true);
    expect(container.textContent).toContain("Mapbox cannot be asked for a language");
  });
});
