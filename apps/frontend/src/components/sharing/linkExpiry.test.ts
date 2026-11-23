import { beforeAll, describe, expect, it } from "vitest";
import i18n from "../../i18n";
import { parseInstant } from "../../util/dateUtils";
import { isLinkExpired, linkExpiryCaption } from "./linkExpiry";

const NOW = parseInstant("2026-11-20T12:00:00Z");

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

describe("isLinkExpired", () => {
  it("never expires a link without a date", () => {
    expect(isLinkExpired(null, NOW)).toBe(false);
    expect(isLinkExpired(undefined, NOW)).toBe(false);
    expect(isLinkExpired("", NOW)).toBe(false);
  });

  it("keeps a link open up to and including its expiry, like the server", () => {
    expect(isLinkExpired("2026-11-20T12:00:00Z", NOW)).toBe(false);
    expect(isLinkExpired("2026-11-20T11:59:59Z", NOW)).toBe(true);
  });

  it("compares instants, whatever offset the date carries", () => {
    expect(isLinkExpired("2026-11-20T13:00:01+01:00", NOW)).toBe(false);
    expect(isLinkExpired("2026-11-20T12:59:59+01:00", NOW)).toBe(true);
  });

  it("does not call an unreadable date expired", () => {
    expect(isLinkExpired("not a date", NOW)).toBe(false);
  });
});

describe("linkExpiryCaption", () => {
  it("has no caption for a link that never expires", () => {
    expect(linkExpiryCaption(i18n.t, null, NOW)).toBeNull();
    expect(linkExpiryCaption(i18n.t, "not a date", NOW)).toBeNull();
  });

  it("says when an open link expires and when an expired one did", () => {
    expect(linkExpiryCaption(i18n.t, "2026-11-23T12:00:00Z", NOW)).toBe("Expires in 3 days");
    expect(linkExpiryCaption(i18n.t, "2026-11-18T12:00:00Z", NOW)).toBe("Expired 2 days ago");
  });
});
