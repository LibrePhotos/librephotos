// eslint-disable-next-line ban/dayjs -- this test checks the dayjs locale loader that Mantine's pickers use
import dayjs from "dayjs";
import { Settings } from "luxon";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import translationDa from "./locales/da/translation.json";
import translationDe from "./locales/de/translation.json";
import translationEn from "./locales/en/translation.json";
import translationFr from "./locales/fr/translation.json";
import { parseInstant } from "./util/dateUtils";

const originalDefaultLocale = Settings.defaultLocale;

// i18n.ts initialises i18next as a side effect of being imported, so each test
// loads a fresh copy after arranging the saved language in localStorage.
const loadI18n = async () => {
  vi.resetModules();
  const module = await import("./i18n");
  await module.i18nReady;
  return module.default;
};

describe("i18n lazy locale loading", () => {
  beforeEach(() => {
    window.localStorage.removeItem("i18nextLng");
  });

  afterEach(() => {
    window.localStorage.removeItem("i18nextLng");
    Settings.defaultLocale = originalDefaultLocale;
  });

  it("sets luxon's default locale to the UI language on start-up", async () => {
    window.localStorage.setItem("i18nextLng", "de-DE");
    await loadI18n();

    expect(Settings.defaultLocale).toBe("de");
    expect(parseInstant("2024-03-15T10:00:00Z").toLocaleString({ month: "long" })).toBe("März");
  });

  it("follows the UI language when the user switches, with no per-call locale", async () => {
    window.localStorage.setItem("i18nextLng", "en");
    const i18n = await loadI18n();
    expect(parseInstant("2024-03-15T10:00:00Z").toLocaleString({ month: "long" })).toBe("March");

    await i18n.changeLanguage("de");

    expect(Settings.defaultLocale).toBe("de");
    expect(parseInstant("2024-03-15T10:00:00Z").toLocaleString({ month: "long" })).toBe("März");
  });

  it("sets the locale tag luxon expects for a language with a script subtag", async () => {
    window.localStorage.setItem("i18nextLng", "en");
    const i18n = await loadI18n();

    await i18n.changeLanguage("nb_NO");

    expect(Settings.defaultLocale).toBe("nb-NO");
  });

  it("bundles English and leaves other locales unloaded until needed", async () => {
    window.localStorage.setItem("i18nextLng", "en");
    const i18n = await loadI18n();

    expect(i18n.hasResourceBundle("en", "translation")).toBe(true);
    expect(i18n.hasResourceBundle("de", "translation")).toBe(false);
    expect(i18n.t("settings.language")).toBe(translationEn.settings.language);
  });

  it("fetches a locale when the user switches language", async () => {
    window.localStorage.setItem("i18nextLng", "en");
    const i18n = await loadI18n();

    await i18n.changeLanguage("de");

    expect(i18n.hasResourceBundle("de", "translation")).toBe(true);
    expect(i18n.resolvedLanguage).toBe("de");
    expect(i18n.t("settings.language")).toBe(translationDe.settings.language);
    expect(document.documentElement.lang).toBe("de");
  });

  it("keeps <html lang> a valid language tag", async () => {
    window.localStorage.setItem("i18nextLng", "en");
    const i18n = await loadI18n();
    expect(document.documentElement.lang).toBe("en");

    await i18n.changeLanguage("zh_Hans");

    expect(document.documentElement.lang).toBe("zh-Hans");
  });

  it("loads the Danish translation Weblate maintains", async () => {
    window.localStorage.setItem("i18nextLng", "da");
    const i18n = await loadI18n();

    expect(i18n.resolvedLanguage).toBe("da");
    expect(i18n.t("settings.language")).toBe(translationDa.settings.language);
  });

  it("loads a saved non-English language before reporting ready", async () => {
    window.localStorage.setItem("i18nextLng", "fr");
    const i18n = await loadI18n();

    expect(i18n.language).toBe("fr");
    expect(i18n.t("settings.language")).toBe(translationFr.settings.language);
  });

  it("falls back from a region variant to its base locale", async () => {
    window.localStorage.setItem("i18nextLng", "de-DE");
    const i18n = await loadI18n();

    expect(i18n.resolvedLanguage).toBe("de");
    expect(i18n.t("settings.language")).toBe(translationDe.settings.language);
    expect(document.documentElement.lang).toBe("de");
  });

  it("falls back to English for keys a locale has not translated", async () => {
    window.localStorage.setItem("i18nextLng", "en");
    const i18n = await loadI18n();
    await i18n.changeLanguage("fr");
    // A French file that has translated one key of the section and not the other.
    i18n.removeResourceBundle("fr", "translation");
    i18n.addResourceBundle("fr", "translation", { sidemenu: { photos: "Photos (fr)" } });

    expect(i18n.t("sidemenu.photos")).toBe("Photos (fr)");
    expect(i18n.t("sidemenu.videos")).toBe(translationEn.sidemenu.videos);
  });
});

describe("loadDayjsLocale", () => {
  it("registers the date picker locale under dayjs's own name", async () => {
    const { loadDayjsLocale } = await import("./i18n");

    expect(await loadDayjsLocale("de")).toBe("de");
    expect(
      dayjs(new Date(2024, 2, 15))
        .locale("de")
        .format("MMMM")
    ).toBe("März");
    expect(await loadDayjsLocale("nb_NO")).toBe("nb");
    expect(await loadDayjsLocale("zh_Hans")).toBe("zh-cn");
  });

  it("keeps English for English and for languages without dayjs data", async () => {
    const { loadDayjsLocale } = await import("./i18n");

    expect(await loadDayjsLocale("en")).toBe("en");
    expect(await loadDayjsLocale(undefined)).toBe("en");
  });
});
