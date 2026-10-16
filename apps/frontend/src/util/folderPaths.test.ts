import { describe, expect, it } from "vitest";
import { childPath, folderName, parentFolder, samePath } from "./folderPaths";

describe("folderPaths", () => {
  it("compares folders with or without a trailing separator", () => {
    expect(samePath("/photos/2025/", "/photos/2025")).toBe(true);
    expect(samePath("C:\\photos\\", "C:\\photos")).toBe(true);
    expect(samePath("/photos/2025", "/photos/2024")).toBe(false);
    expect(samePath("C:/data/photos\\Lisbon", "c:\\data\\photos\\Lisbon\\")).toBe(true);
    expect(samePath("\\\\nas\\photos", "//nas/photos")).toBe(true);
    // On POSIX a backslash belongs to the name.
    expect(samePath("/photos/a\\b", "/photos/a/b")).toBe(false);
  });

  it("finds the folder of a file on either system", () => {
    expect(parentFolder("/photos/2025/IMG_1.jpg")).toBe("/photos/2025");
    expect(parentFolder("C:\\photos\\IMG_1.jpg")).toBe("C:\\photos");
    expect(parentFolder("/IMG_1.jpg")).toBe("/");
  });

  it("joins a new folder with the separator the path uses", () => {
    expect(childPath("/photos/", " Porto ")).toBe("/photos/Porto");
    expect(childPath("C:\\photos", "Porto")).toBe("C:\\photos\\Porto");
    expect(childPath("C:/data\\photos", "Porto")).toBe("C:/data\\photos/Porto");
  });

  it("names a folder by its last part", () => {
    expect(folderName("/photos/2025/Porto/")).toBe("Porto");
    expect(folderName("C:\\photos\\Porto")).toBe("Porto");
    expect(folderName("/")).toBe("/");
  });
});
