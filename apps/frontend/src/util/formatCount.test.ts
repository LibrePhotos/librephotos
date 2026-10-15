import { describe, expect, it } from "vitest";
import { formatCompactCount, formatCount, formatPercent, formatUnitList, intlLocale } from "./formatCount";

describe("formatCompactCount", () => {
  it("leaves small numbers untouched", () => {
    expect(formatCompactCount(0)).toBe("0");
    expect(formatCompactCount(999)).toBe("999");
  });

  it("abbreviates thousands and millions", () => {
    expect(formatCompactCount(25123)).toBe("25.1K");
    expect(formatCompactCount(1500000)).toBe("1.5M");
  });

  it("handles the thousand boundary", () => {
    expect(formatCompactCount(1000)).toBe("1K");
    expect(formatCompactCount(1049)).toBe("1K");
  });

  it("rolls over to the next unit once rounding reaches it", () => {
    expect(formatCompactCount(999_499)).toBe("999.5K");
    expect(formatCompactCount(999_950)).toBe("1M");
  });

  it("follows the requested locale", () => {
    // German only abbreviates from a million and uses its own separators.
    expect(formatCompactCount(25123, "de")).toBe("25.123");
    expect(formatCompactCount(1500000, "de")).toBe("1,5 Mio.");
    expect(formatCompactCount(25123, "fr")).toBe("25,1 k");
  });
});

describe("formatCount", () => {
  it("groups digits for the requested locale", () => {
    expect(formatCount(999)).toBe("999");
    expect(formatCount(25123)).toBe("25,123");
    expect(formatCount(25123, "de")).toBe("25.123");
  });
});

// Intl separates a number from its unit or sign with a no-break space in many locales.
const plain = (text: string) => text.replace(/\s/g, " ");

describe("formatPercent", () => {
  it("writes a fraction the locale's way, with one decimal at most", () => {
    expect(formatPercent(0.1234)).toBe("12.3%");
    expect(plain(formatPercent(0.1234, "de"))).toBe("12,3 %");
    expect(formatPercent(1)).toBe("100%");
  });

  it("takes the number of decimals", () => {
    expect(formatPercent(1.728, "en", 0)).toBe("173%");
  });

  it("falls back to English for a tag Intl rejects", () => {
    expect(formatPercent(0.5, "pt_BR")).toBe("50%");
  });
});

describe("formatUnitList", () => {
  it("joins counted phrases the way the locale lists them", () => {
    expect(formatUnitList(["12 days", "340 photos"])).toBe("12 days, 340 photos");
    expect(formatUnitList(["12 jours", "340 photos"], "fr")).toBe("12 jours et 340 photos");
  });

  it("falls back to English for a tag Intl rejects", () => {
    expect(formatUnitList(["a", "b"], "not a tag")).toBe("a, b");
  });
});

describe("intlLocale", () => {
  it("turns an i18next language code into an Intl tag", () => {
    expect(intlLocale("pt_BR")).toBe("pt-BR");
    expect(intlLocale("zh_Hans")).toBe("zh-Hans");
    expect(intlLocale("de")).toBe("de");
    expect(intlLocale(undefined)).toBe("en");
  });
});
