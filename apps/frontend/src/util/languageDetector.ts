import type { LanguageDetectorModule } from "i18next";
import { readCookie } from "../api_client/documentCookie";
import { readStoredLanguage, writeStoredLanguage } from "./storage";

export type LanguageSources = Readonly<{
  search: string;
  hash: string;
  cookie: string | undefined;
  localStorage: string | undefined;
  sessionStorage: string | undefined;
  navigator: readonly string[];
  htmlLang: string | null;
}>;

const PROTOTYPE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function isSafeLanguageCode(code: string): boolean {
  return /^[A-Za-z0-9_@.-]{1,128}$/.test(code) && !code.includes("..") && !PROTOTYPE_KEYS.has(code);
}

function queryLanguage(search: string, hash: string): string | undefined {
  const query = !search && hash.includes("?") ? hash.slice(hash.indexOf("?")) : search;
  let found: string | undefined;
  for (const param of query.slice(1).split("&")) {
    const equals = param.indexOf("=");
    if (equals > 0 && param.slice(0, equals) === "lng") {
      found = param.slice(equals + 1);
    }
  }
  return found;
}

export function detectLanguages(sources: LanguageSources): string[] {
  const candidates = [
    queryLanguage(sources.search, sources.hash),
    sources.cookie,
    sources.localStorage,
    sources.sessionStorage,
    ...sources.navigator,
    sources.htmlLang,
  ];
  return candidates.filter(
    (code): code is string => typeof code === "string" && code !== "" && isSafeLanguageCode(code)
  );
}

function navigatorLanguages(): string[] {
  if (typeof navigator === "undefined") return [];
  return [...(navigator.languages ?? []), navigator.language].filter(Boolean);
}

function readLanguageSources(): LanguageSources {
  const hasWindow = typeof window !== "undefined";
  return {
    search: hasWindow ? window.location.search : "",
    hash: hasWindow ? window.location.hash : "",
    cookie: typeof document !== "undefined" ? readCookie("i18next") : undefined,
    localStorage: readStoredLanguage("local"),
    sessionStorage: readStoredLanguage("session"),
    navigator: navigatorLanguages(),
    htmlLang: typeof document !== "undefined" ? document.documentElement.getAttribute("lang") : null,
  };
}

export const browserLanguageDetector: LanguageDetectorModule = {
  type: "languageDetector",
  detect: () => detectLanguages(readLanguageSources()),
  cacheUserLanguage: language => {
    if (language !== "cimode") writeStoredLanguage(language);
  },
};
