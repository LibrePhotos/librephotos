/**
 * What keeping a library in a commercial cloud would cost: the thank-you dialog and Rewind compare
 * it with LibrePhotos. US list prices, yearly, checked in November 2026 against the providers' plan
 * pages; update them (and CLOUD_PRICES_CHECKED) when a release goes out. Only storage is compared,
 * plan for plan: the smallest plan of each provider that holds the library.
 */
export const CLOUD_PRICES_CHECKED = "2026-11";

type CloudPlan = Readonly<{
  provider: string;
  /** Decimal gigabytes, as the providers sell them (2 TB = 2000 GB). */
  storageGb: number;
  yearlyUsd: number;
}>;

const GB = 1000 ** 3;

const CLOUD_PLANS: readonly CloudPlan[] = [
  // The free tiers: a library that fits in one saves nothing, and the dialog says nothing about money.
  { provider: "Google One", storageGb: 15, yearlyUsd: 0 },
  { provider: "Google One", storageGb: 100, yearlyUsd: 19.99 },
  { provider: "Google One", storageGb: 2000, yearlyUsd: 99.99 },
  // Monthly only: 12 times $0.99, $2.99, $9.99, $29.99 and $59.99.
  { provider: "iCloud+", storageGb: 5, yearlyUsd: 0 },
  { provider: "iCloud+", storageGb: 50, yearlyUsd: 11.88 },
  { provider: "iCloud+", storageGb: 200, yearlyUsd: 35.88 },
  { provider: "iCloud+", storageGb: 2000, yearlyUsd: 119.88 },
  { provider: "iCloud+", storageGb: 6000, yearlyUsd: 359.88 },
  { provider: "iCloud+", storageGb: 12000, yearlyUsd: 719.88 },
];

/**
 * Per provider, its smallest plan that holds `bytes`, cheapest first. A provider whose biggest plan
 * is too small is left out; a library bigger than every plan gets an empty list.
 */
export function plansFor(bytes: number, plans: readonly CloudPlan[] = CLOUD_PLANS): CloudPlan[] {
  const gb = bytes / GB;
  const byProvider = new Map<string, CloudPlan>();
  for (const plan of plans) {
    if (plan.storageGb < gb) continue;
    const best = byProvider.get(plan.provider);
    if (!best || plan.storageGb < best.storageGb) byProvider.set(plan.provider, plan);
  }
  return [...byProvider.values()].sort((a, b) => a.yearlyUsd - b.yearlyUsd);
}

/** What the cheapest provider charges a year for `bytes`; 0 when a free tier holds it or none can. */
export function yearlySaving(bytes: number): number {
  return plansFor(bytes)[0]?.yearlyUsd ?? 0;
}

/** "100 GB", "2 TB": a plan's size as the providers write it. */
export function planSize(storageGb: number): string {
  return storageGb >= 1000 ? `${storageGb / 1000} TB` : `${storageGb} GB`;
}

/** A library's size the way the plans are sold: "418 GB", "1.2 TB". */
export function librarySize(bytes: number, locale: string): string {
  const gb = bytes / GB;
  const format = new Intl.NumberFormat(locale, { maximumFractionDigits: gb >= 1000 || gb < 10 ? 1 : 0 });
  return gb >= 1000 ? `${format.format(gb / 1000)} TB` : `${format.format(gb)} GB`;
}

/** A price in US dollars, as the plans list it. */
export function usd(amount: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: Number.isInteger(amount) ? 0 : 2,
  }).format(amount);
}
