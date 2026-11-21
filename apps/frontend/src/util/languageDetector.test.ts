import { afterEach, describe, expect, it } from "vitest";
import { browserLanguageDetector, detectLanguages, type LanguageSources } from "./languageDetector";

const none: LanguageSources = {
  search: "",
  hash: "",
  cookie: undefined,
  localStorage: undefined,
  sessionStorage: undefined,
  navigator: [],
  htmlLang: null,
};

describe("detectLanguages", () => {
  it("lists the sources in i18next-browser-languagedetector's default order", () => {
    expect(
      detectLanguages({
        search: "?lng=fr",
        hash: "",
        cookie: "es",
        localStorage: "de",
        sessionStorage: "it",
        navigator: ["pt-BR", "pt"],
        htmlLang: "en",
      })
    ).toEqual(["fr", "es", "de", "it", "pt-BR", "pt", "en"]);
  });

  it("takes the last lng parameter, and one after a ? in the hash when the URL has no query", () => {
    expect(detectLanguages({ ...none, search: "?lng=fr&x=1&lng=nl" })).toEqual(["nl"]);
    expect(detectLanguages({ ...none, hash: "#/page?lng=ja" })).toEqual(["ja"]);
    expect(detectLanguages({ ...none, search: "?a=1", hash: "#/page?lng=ja" })).toEqual([]);
  });

  it("drops empty and unsafe codes", () => {
    expect(
      detectLanguages({
        ...none,
        search: "?lng=",
        cookie: '" onmouseover="x()',
        localStorage: "__proto__",
        sessionStorage: "a..b",
        navigator: ["<b>x</b>", "sr@latin", "zh_Hans"],
      })
    ).toEqual(["sr@latin", "zh_Hans"]);
  });
});

describe("browserLanguageDetector", () => {
  afterEach(() => {
    window.localStorage.removeItem("i18nextLng");
    window.sessionStorage.removeItem("i18nextLng");
  });

  it("reads the saved language before the browser's", () => {
    window.localStorage.setItem("i18nextLng", "pt_BR");
    const detected = browserLanguageDetector.detect();
    expect(Array.isArray(detected) ? detected[0] : detected).toBe("pt_BR");
  });

  it("saves the chosen language under i18nextLng, but not cimode", () => {
    browserLanguageDetector.cacheUserLanguage?.("de");
    expect(window.localStorage.getItem("i18nextLng")).toBe("de");
    browserLanguageDetector.cacheUserLanguage?.("cimode");
    expect(window.localStorage.getItem("i18nextLng")).toBe("de");
  });

  it("ends with the browser's languages and the page's lang attribute", () => {
    document.documentElement.lang = "en";
    const detected = browserLanguageDetector.detect();
    expect(Array.isArray(detected) ? detected.slice(-2) : detected).toEqual([navigator.language, "en"]);
  });
});
