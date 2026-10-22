import type { ComboboxData } from "@mantine/core";
import { beforeAll, describe, expect, it } from "vitest";
import i18n from "../../i18n";
import { isLanguageCode, placeLanguageName, placeLanguageOptions, PROVIDER_DEFAULT } from "./placeLanguageOptions";

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

/** Each top-level entry as "value" or "group: first values". */
function outline(data: ComboboxData): string[] {
  return data.map(entry => {
    if (typeof entry === "string") return entry;
    if ("group" in entry) {
      const values = entry.items.map(item => (typeof item === "string" ? item : item.value));
      return `${entry.group}: ${values.slice(0, 3).join(" ")}`;
    }
    return entry.value;
  });
}

describe("isLanguageCode", () => {
  it("takes a language code or a list of them", () => {
    for (const code of ["de", "pt-BR", "zh-Hans", "de,en", "fil"]) {
      expect(isLanguageCode(code), code).toBe(true);
    }
  });

  it("refuses what the backend refuses", () => {
    for (const text of ["", "german", "d", "de,", "pt_BR", "de;en", "de en"]) {
      expect(isLanguageCode(text), text).toBe(false);
    }
  });
});

describe("placeLanguageOptions", () => {
  it("lists the provider's default, the interface language, then every language", () => {
    const data = placeLanguageOptions(i18n.t, "de", []);

    expect(outline(data)).toEqual([PROVIDER_DEFAULT, "Your interface language: de", "All languages: en ca es"]);
    expect(JSON.stringify(data)).toContain('"label":"German (de)"');
    expect(JSON.stringify(data)).toContain('"value":"pt-BR"');
  });

  it("leaves out the interface-language group for a language it does not list", () => {
    expect(outline(placeLanguageOptions(i18n.t, "xx", []))).toEqual([PROVIDER_DEFAULT, "All languages: en ca de"]);
  });

  it("offers a code no language has under Other, once", () => {
    const data = placeLanguageOptions(i18n.t, "en", ["de,en", "", "de", "de,en", "PT-br"]);

    expect(outline(data).at(-1)).toBe("Other codes: de,en PT-br");
  });
});

describe("placeLanguageName", () => {
  it("names a code it knows, and gives back one it does not", () => {
    expect(placeLanguageName(i18n.t, "de")).toBe("German");
    expect(placeLanguageName(i18n.t, "pt-br")).toBe(placeLanguageName(i18n.t, "pt-BR"));
    expect(placeLanguageName(i18n.t, "de,en")).toBe("de,en");
  });
});
