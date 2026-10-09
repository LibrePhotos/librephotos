import { describe, expect, it } from "vitest";
import { calculateMD5 } from "./chunkedUpload";

describe("calculateMD5", () => {
  it("settles for an empty file instead of waiting forever", async () => {
    await expect(calculateMD5(new File([], "empty.jpg"))).resolves.toBe("d41d8cd98f00b204e9800998ecf8427e");
  });

  it("hashes the file contents", async () => {
    await expect(calculateMD5(new File(["abc"], "abc.txt"))).resolves.toBe("900150983cd24fb0d6963f7d28e17f72");
  });
});
