import { describe, expect, it } from "vitest";
import { formatFileSize } from "./fileSize";

// Intl separates a number from its unit with a no-break space in many locales.
const plain = (text: string) => text.replace(/\s/g, " ");

describe("formatFileSize", () => {
  it("uses decimal units with three significant digits", () => {
    expect(formatFileSize(0, "en")).toBe("0 byte");
    expect(formatFileSize(512, "en")).toBe("512 byte");
    expect(formatFileSize(1_234, "en")).toBe("1.23 kB");
    expect(formatFileSize(8_420_000, "en")).toBe("8.42 MB");
    expect(formatFileSize(26_400_000, "en")).toBe("26.4 MB");
    expect(formatFileSize(1_500_000_000, "en")).toBe("1.5 GB");
    expect(formatFileSize(2_000_000_000_000, "en")).toBe("2 TB");
  });

  it("moves to the next unit once rounding reaches 1000", () => {
    expect(formatFileSize(999_400, "en")).toBe("999 kB");
    expect(formatFileSize(999_960, "en")).toBe("1 MB");
  });

  it("writes the number and the unit in the UI language", () => {
    expect(plain(formatFileSize(8_420_000, "de"))).toBe("8,42 MB");
    expect(plain(formatFileSize(8_420_000, "fr"))).toBe("8,42 Mo");
    expect(plain(formatFileSize(512, "de"))).toBe("512 Byte");
  });

  it("stops at the largest unit and never shows a negative size", () => {
    expect(formatFileSize(5e18, "en")).toBe("5,000 PB");
    expect(formatFileSize(-1, "en")).toBe("0 byte");
  });

  it("falls back to English for a tag Intl rejects", () => {
    expect(formatFileSize(8_420_000, "pt_BR")).toBe("8.42 MB");
  });
});
