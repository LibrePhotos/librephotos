import { describe, expect, it } from "vitest";
import { fileNameOf, folderOf, photoDate } from "./photoPageText";

describe("photo page text", () => {
  it("titles a photo by its date and keeps the time apart", () => {
    const date = photoDate("2024-08-17T20:41:00Z");
    expect(date?.date).toContain("2024");
    expect(date?.date).toContain("17");
    expect(date?.time).toMatch(/8:41|20:41/);
  });

  it("has no title date without a usable timestamp", () => {
    expect(photoDate(null)).toBeNull();
    expect(photoDate(undefined)).toBeNull();
    expect(photoDate("not a date")).toBeNull();
  });

  it("splits a path from either kind of backend", () => {
    expect(fileNameOf("C:\\Photos\\Trip\\IMG_1.jpg")).toBe("IMG_1.jpg");
    expect(fileNameOf("/photos/trip/IMG_1.jpg")).toBe("IMG_1.jpg");
    expect(folderOf("C:\\Photos\\Trip\\IMG_1.jpg")).toBe("C:/Photos/Trip");
    expect(folderOf("/photos/trip/IMG_1.jpg")).toBe("/photos/trip");
  });
});
