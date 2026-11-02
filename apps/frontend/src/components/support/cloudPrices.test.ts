import { describe, expect, it } from "vitest";
import { librarySize, plansFor, planSize, usd, yearlySaving } from "./cloudPrices";

const GB = 1000 ** 3;

describe("plansFor", () => {
  it("picks each provider's smallest plan that holds the library, cheapest first", () => {
    expect(plansFor(418 * GB)).toEqual([
      { provider: "Google One", storageGb: 2000, yearlyUsd: 99.99 },
      { provider: "iCloud+", storageGb: 2000, yearlyUsd: 119.88 },
    ]);
    expect(plansFor(80 * GB).map(plan => plan.storageGb)).toEqual([100, 200]);
  });

  it("leaves out a provider without a plan big enough", () => {
    expect(plansFor(3000 * GB)).toEqual([{ provider: "iCloud+", storageGb: 6000, yearlyUsd: 359.88 }]);
    expect(plansFor(20_000 * GB)).toEqual([]);
  });
});

describe("yearlySaving", () => {
  it("is what the cheapest fitting plan costs", () => {
    expect(yearlySaving(418 * GB)).toBe(99.99);
  });

  it("is nothing when a free tier holds the library, or no plan does", () => {
    expect(yearlySaving(4 * GB)).toBe(0);
    expect(yearlySaving(20_000 * GB)).toBe(0);
  });
});

describe("formatting", () => {
  it("writes sizes and prices as the plans do", () => {
    expect(planSize(2000)).toBe("2 TB");
    expect(planSize(100)).toBe("100 GB");
    expect(librarySize(418 * GB, "en")).toBe("418 GB");
    expect(librarySize(1234 * GB, "en")).toBe("1.2 TB");
    expect(usd(99.99, "en")).toBe("$99.99");
    expect(usd(0, "en")).toBe("$0");
  });
});
