import dayjs from "dayjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import translationDa from "./locales/da/translation.json";
import translationDe from "./locales/de/translation.json";
import translationEn from "./locales/en/translation.json";
import translationFr from "./locales/fr/translation.json";

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
    i18n.addResource("en", "translation", "only.in.english", "English only");

    await i18n.changeLanguage("fr");

    expect(i18n.t("only.in.english")).toBe("English only");
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
