import { describe, expect, it, vi } from "vitest";
import { calculateMD5, UploadCancelledError } from "./chunkedUpload";

describe("calculateMD5", () => {
  it("settles for an empty file instead of waiting forever", async () => {
    await expect(calculateMD5(new File([], "empty.jpg"))).resolves.toBe("d41d8cd98f00b204e9800998ecf8427e");
  });

  it("hashes the file contents", async () => {
    await expect(calculateMD5(new File(["abc"], "abc.txt"))).resolves.toBe("900150983cd24fb0d6963f7d28e17f72");
  });

  it("stops between slices once the upload is cancelled", async () => {
    // Three 2-byte slices: the check runs after the first one and stops there.
    const isCancelled = vi.fn(() => true);
    await expect(calculateMD5(new File(["abcdef"], "big.mov"), isCancelled, 2)).rejects.toBeInstanceOf(
      UploadCancelledError
    );
    expect(isCancelled).toHaveBeenCalledTimes(1);
  });

  it("hashes slice by slice to the same result", async () => {
    await expect(calculateMD5(new File(["abc"], "abc.txt"), () => false, 2)).resolves.toBe(
      "900150983cd24fb0d6963f7d28e17f72"
    );
  });
});
