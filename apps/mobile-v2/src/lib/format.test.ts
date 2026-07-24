import { formatBytes } from "./format";

describe("formatBytes", () => {
  it("formats byte sizes with sensible units", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(-5)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(2 * 1024 * 1024 * 1024)).toBe("2 GB");
  });
});
