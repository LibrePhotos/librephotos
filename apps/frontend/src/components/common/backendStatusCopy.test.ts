/** The text BackendStatusGate picks for the server's answer, and what Copy details copies (#2310). */
import { describe, expect, it } from "vitest";
import { statusScreen, supportDetails } from "./backendStatusCopy";

describe("statusScreen", () => {
  it.each([
    ["updating", null, "updating"],
    ["starting", null, "starting"],
    ["unreachable", null, "unreachable"],
    ["failed", "E001", "failed.E001"],
    ["failed", "E002", "failed.E002"],
    ["failed", "E042", "failed.unknown"],
    ["failed", null, "failed.unknown"],
  ] as const)("%s with reason %s is %s", (state, reasonCode, screen) => {
    expect(statusScreen({ state, reasonCode, version: null })).toBe(screen);
  });
});

describe("supportDetails", () => {
  it("names the state, reason code, version, address and time, nothing else", () => {
    const text = supportDetails({
      readiness: { state: "failed", reasonCode: "E001", version: "1.4.0" },
      version: "1.4.0",
      address: "https://photos.example.com",
      time: "2026-10-15T19:00:00.000Z",
    });
    expect(text).toBe(
      [
        "LibrePhotos status: failed",
        "Reason code: E001",
        "Version: 1.4.0",
        "Address: https://photos.example.com",
        "Time: 2026-10-15T19:00:00.000Z",
      ].join("\n")
    );
  });

  it("says when the version and the reason are not known", () => {
    const text = supportDetails({
      readiness: { state: "unreachable", reasonCode: null, version: null },
      version: null,
      address: "http://localhost:3000",
      time: "2026-10-15T19:00:00.000Z",
    });
    expect(text).toContain("Reason code: none");
    expect(text).toContain("Version: unknown");
  });
});
