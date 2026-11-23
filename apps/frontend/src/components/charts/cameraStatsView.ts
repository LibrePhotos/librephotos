import type { CameraStats, RangeBucket, SearchFilters } from "@librephotos/api-client";
import type { TFunction } from "i18next";
import { RANGE_FIELDS, type RangeField } from "../search/searchFilterRanges";
import type { DistributionBar } from "./DistributionBarChart";
import type { RankRow } from "./RankBarList";

export type ExposureChart = Readonly<{
  key: RangeField["id"];
  title: string;
  summary: string;
  bars: readonly DistributionBar[];
}>;

type BucketStat = "iso" | "aperture" | "focal_length" | "focal_length_35mm" | "shutter_speed";

const EXPOSURE_STATS: ReadonlyArray<Readonly<{ id: RangeField["id"]; stat: BucketStat }>> = [
  { id: "iso", stat: "iso" },
  { id: "aperture", stat: "aperture" },
  { id: "focal", stat: "focal_length" },
  { id: "focal35", stat: "focal_length_35mm" },
  { id: "shutter", stat: "shutter_speed" },
];

export function bucketSearch(bucket: RangeBucket, field: RangeField): SearchFilters {
  const end = (value: number) => (field.integer ? Math.round(value) : value);
  const search: SearchFilters = {};
  search[field.min] = end(bucket.min);
  search[field.max] = end(bucket.max);
  return search;
}

export function rangeBars(buckets: readonly RangeBucket[], field: RangeField, t: TFunction): DistributionBar[] {
  const name = t(field.labelKey);
  return buckets.map(bucket => ({
    key: bucket.label,
    axis: bucket.label,
    name: t("statistics.bucketname", { name, value: bucket.label }),
    count: bucket.count,
    search: bucketSearch(bucket, field),
  }));
}

function chartSummary(name: string, bars: readonly DistributionBar[], t: TFunction): string {
  const peak = bars.reduce<DistributionBar | undefined>(
    (most, bar) => (most && most.count >= bar.count ? most : bar),
    undefined
  );
  return t("statistics.distchartsummary", {
    name,
    from: bars[0]?.axis,
    to: bars.at(-1)?.axis,
    peak: peak?.axis,
    value: t("statistics.photocount", { count: peak?.count ?? 0 }),
  });
}

export function exposureCharts(stats: CameraStats, t: TFunction): ExposureChart[] {
  return EXPOSURE_STATS.flatMap(({ id, stat }) => {
    const field = RANGE_FIELDS.find(candidate => candidate.id === id);
    const buckets = stats[stat];
    if (!field || buckets.length === 0) return [];
    const title = t(field.labelKey);
    const bars = rangeBars(buckets, field, t);
    return [{ key: id, title, summary: chartSummary(title, bars, t), bars }];
  });
}

export function cameraRows(cameras: CameraStats["cameras"]): RankRow[] {
  return cameras.map(row => ({
    key: `${row.make.toLowerCase()}|${row.value.toLowerCase()}`,
    label: row.label,
    count: row.count,
    search: row.make ? { camera: row.value, make: row.make } : { camera: row.value },
  }));
}

export function lensRows(lenses: CameraStats["lenses"]): RankRow[] {
  return lenses.map(row => ({
    key: row.value.toLowerCase(),
    label: row.label,
    count: row.count,
    search: { lens: row.value },
  }));
}
