// eslint-disable-next-line ban/dayjs -- this test checks the dayjs locale loader that Mantine's pickers use
import dayjs from "dayjs";
import { Settings } from "luxon";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LANGUAGE_OPTIONS } from "./components/settings/languageOptions";
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

  it("loads the things' names only when a page asks for them (#2744)", async () => {
    window.localStorage.setItem("i18nextLng", "de");
    const i18n = await loadI18n();
    expect(i18n.hasResourceBundle("en", "tags")).toBe(false);
    expect(i18n.hasResourceBundle("de", "tags")).toBe(false);

    await i18n.loadNamespaces("tags");

    expect(i18n.getResource("en", "tags", "beach")).toBe("beach");
    // No German file yet (Weblate adds it): an empty bundle, so English shows
    expect(i18n.getResourceBundle("de", "tags")).toEqual({});
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

// Every translation file as text, so a broken one fails its own test instead of the import.
const localeSources = import.meta.glob<string>("./locales/*/translation.json", {
  query: "?raw",
  import: "default",
  eager: true,
});
// "./locales/pt_BR/translation.json" -> "pt_BR"
const localeDirectories = Object.keys(localeSources)
  .map(path => path.split("/")[2] ?? path)
  .sort();
const translatedLocales = localeDirectories.filter(locale => locale !== "en");
const pickerValues = LANGUAGE_OPTIONS.map(option => option.value);

const parseLocale = (locale: string): unknown =>
  JSON.parse(localeSources[`./locales/${locale}/translation.json`] ?? "");

// Weblate adds a directory under src/locales when a translator starts a language. i18n.ts loads it
// without a code change; the picker and dayjs need a human-written entry, so these tests ask for one.
describe("locale directories", () => {
  afterEach(() => {
    window.localStorage.removeItem("i18nextLng");
    Settings.defaultLocale = originalDefaultLocale;
  });

  it("finds the locales Weblate maintains", () => {
    expect(localeDirectories).toContain("en");
    expect(localeDirectories).toContain("pt_BR");
    expect(translatedLocales.length).toBeGreaterThan(30);
  });

  it.each(localeDirectories)("%s/translation.json is a JSON object", locale => {
    const translation = parseLocale(locale);

    expect(translation).toBeTypeOf("object");
    expect(Array.isArray(translation)).toBe(false);
  });

  it("offers every locale directory in the language picker (components/settings/languageOptions.ts)", () => {
    expect(localeDirectories.filter(locale => !pickerValues.includes(locale))).toEqual([]);
  });

  it("offers no language without a locale directory", () => {
    expect(pickerValues.filter(value => !localeDirectories.includes(value))).toEqual([]);
    expect(new Set(pickerValues).size).toBe(pickerValues.length);
  });

  it("loads every locale directory through the lazy backend", async () => {
    window.localStorage.setItem("i18nextLng", "en");
    const i18n = await loadI18n();

    for (const locale of translatedLocales) {
      await i18n.changeLanguage(locale);
      expect(i18n.getResourceBundle(locale, "translation"), locale).toEqual(parseLocale(locale));
    }
  });

  it("gives every locale directory a dayjs locale for the date pickers (dayjsLocaleLoaders in i18n.ts)", async () => {
    const { loadDayjsLocale } = await import("./i18n");
    const names = await Promise.all(translatedLocales.map(locale => loadDayjsLocale(locale)));

    expect(translatedLocales.filter((_, index) => names[index] === "en")).toEqual([]);
  });
});
