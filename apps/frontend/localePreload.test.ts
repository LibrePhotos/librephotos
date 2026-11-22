import { describe, expect, it } from "vitest";
import { localesToPreload, preloadScript } from "./localePreload";

const files = { en: "/assets/en.js", de: "/assets/de.js", pt_BR: "/assets/pt_BR.js", zh_Hans: "/assets/zh.js" };

describe("localesToPreload", () => {
  it("preloads only English for an English browser", () => {
    expect(localesToPreload(files, "", null, ["en-US", "de"])).toEqual(["/assets/en.js"]);
  });

  it("preloads the saved language and English, its fallback", () => {
    expect(localesToPreload(files, "", "pt_BR", ["en-US"])).toEqual(["/assets/pt_BR.js", "/assets/en.js"]);
  });

  it("follows the browser's first language down to its base", () => {
    expect(localesToPreload(files, "", null, ["de-AT", "en"])).toEqual(["/assets/de.js", "/assets/en.js"]);
  });

  it("puts a lng query parameter before the saved language", () => {
    expect(localesToPreload(files, "?lng=zh_Hans", "de", [])).toEqual(["/assets/zh.js", "/assets/en.js"]);
  });

  it("falls back to English for a language without a file", () => {
    expect(localesToPreload(files, "", "xx", [])).toEqual(["/assets/en.js"]);
  });
});

describe("preloadScript", () => {
  it("adds a modulepreload link for each locale the page will load", () => {
    window.localStorage.setItem("i18nextLng", "de");
    try {
      window.eval(preloadScript(files));
    } finally {
      window.localStorage.removeItem("i18nextLng");
    }
    const links = [...document.head.querySelectorAll<HTMLLinkElement>('link[rel="modulepreload"]')];
    expect(links.map(link => link.getAttribute("href"))).toEqual(["/assets/de.js", "/assets/en.js"]);
    links.forEach(link => link.remove());
  });
});
