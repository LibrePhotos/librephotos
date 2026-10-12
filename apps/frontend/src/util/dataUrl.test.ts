import { describe, expect, it } from "vitest";
import { dataUrlToFile } from "./dataUrl";

describe("dataUrlToFile", () => {
  it("reads a base64 data URL into a File of its declared type", async () => {
    const file = await dataUrlToFile(`data:image/png;base64,${btoa("png bytes")}`, "avatar.png");

    expect(file.name).toBe("avatar.png");
    expect(file.type).toBe("image/png");
    expect(await file.text()).toBe("png bytes");
  });

  it("takes an explicit type over the declared one", async () => {
    const file = await dataUrlToFile("data:text/plain,hello", "a.txt", "application/octet-stream");

    expect(file.type).toBe("application/octet-stream");
    expect(await file.text()).toBe("hello");
  });

  it("refuses anything but a data URL", async () => {
    await expect(dataUrlToFile("/media/photos/abc", "x.png")).rejects.toThrow("data: URLs only");
    await expect(dataUrlToFile("https://example.com/a.png", "x.png")).rejects.toThrow("data: URLs only");
  });
});
