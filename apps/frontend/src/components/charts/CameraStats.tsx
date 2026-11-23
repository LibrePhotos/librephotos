import type { SearchFilters } from "@librephotos/api-client";
import { Grid, Stack, Title } from "@mantine/core";
import { useElementSize } from "@mantine/hooks";
import { IconCamera } from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { useFetchCameraStatsQuery } from "../../api_client/stats/hooks";
import { i18nResolvedLanguage } from "../../i18n";
import { EmptyState } from "../common/EmptyState";
import { ErrorState } from "../common/ErrorState";
import { PageLoader } from "../common/PageLoader";
import { useListFailure } from "../common/useListFailure";
import { formatRangeValue, type ChipContext } from "../search/searchFilterLabels";
import { RANGE_FIELDS, type RangeField } from "../search/searchFilterRanges";
import { DistributionBarChart, type DistributionBar } from "./DistributionBarChart";
import { RankBarList, type RankRow } from "./RankBarList";
import classes from "./StatisticsCharts.module.css";

const RANK_LIMIT = 12;

type ExposureChart = Readonly<{
  key: string;
  title: string;
  summary: string;
  bars: readonly DistributionBar[];
}>;

type NumberRow = Readonly<{ value: number; count: number }>;

type FormatContext = Pick<ChipContext, "t" | "language">;

const EXPOSURE_STATS: ReadonlyArray<{
  id: RangeField["id"];
  stat: "iso" | "aperture" | "focal_length" | "focal_length_35mm";
}> = [
  { id: "iso", stat: "iso" },
  { id: "aperture", stat: "aperture" },
  { id: "focal", stat: "focal_length" },
  { id: "focal35", stat: "focal_length_35mm" },
];

function numberBars(rows: readonly NumberRow[], field: RangeField, ctx: FormatContext): DistributionBar[] {
  return rows.map(row => {
    const axis = formatRangeValue(field, row.value, ctx);
    const search: SearchFilters = {};
    const value = field.integer ? Math.round(row.value) : row.value;
    search[field.min] = value;
    search[field.max] = value;
    return { key: String(row.value), axis, name: `${ctx.t(field.labelKey)} ${axis}`, count: row.count, search };
  });
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

function MeasuredBars({
  chart,
  onSelect,
}: Readonly<{ chart: ExposureChart; onSelect: (bar: DistributionBar) => void }>) {
  const { ref, width, height } = useElementSize<HTMLDivElement>();
  return (
    <div ref={ref} className={classes.distributionPlot}>
      {width > 0 && (
        <DistributionBarChart
          bars={chart.bars}
          summary={chart.summary}
          onSelect={onSelect}
          width={width}
          height={height}
        />
      )}
    </div>
  );
}

export function CameraStats() {
  const { t } = useTranslation();
  const statsQuery = useFetchCameraStatsQuery();
  const { data: stats, isLoading } = statsQuery;
  const listFailure = useListFailure(statsQuery);
  const navigate = useNavigate();
  const ctx = { t, language: i18nResolvedLanguage() };

  const onSelect = (bar: DistributionBar) => void navigate({ to: "/search", search: bar.search });

  const cameraRows: RankRow[] = (stats?.cameras ?? []).slice(0, RANK_LIMIT).map(row => ({
    key: `${row.make} ${row.value}`,
    label: row.label,
    count: row.count,
    search: row.make ? { camera: row.value, make: row.make } : { camera: row.value },
  }));
  const lensRows: RankRow[] = (stats?.lenses ?? []).slice(0, RANK_LIMIT).map(row => ({
    key: row.value,
    label: row.label,
    count: row.count,
    search: { lens: row.value },
  }));

  const charts: ExposureChart[] = [];
  if (stats) {
    for (const { id, stat } of EXPOSURE_STATS) {
      const field = RANGE_FIELDS.find(candidate => candidate.id === id);
      const rows = stats[stat];
      if (!field || rows.length === 0) continue;
      const bars = numberBars(rows, field, ctx);
      charts.push({ key: id, title: t(field.labelKey), summary: chartSummary(t(field.labelKey), bars, t), bars });
    }
    if (stats.shutter_speed.length > 0) {
      const name = t("searchfilter.shutter.label");
      const bars: DistributionBar[] = stats.shutter_speed.map(row => ({
        key: row.value,
        axis: row.value,
        name: `${name} ${row.value}`,
        count: row.count,
        search: { shutter: row.value },
      }));
      charts.push({ key: "shutter", title: name, summary: chartSummary(name, bars, t), bars });
    }
  }

  const hasData = cameraRows.length + lensRows.length + charts.length > 0;

  if (isLoading) return <PageLoader />;
  if (listFailure) return <ErrorState failure={listFailure} />;
  if (!hasData) {
    return (
      <EmptyState
        icon={<IconCamera size={40} />}
        title={t("emptystate.camerastats.title")}
        description={t("emptystate.camerastats.description")}
        actionLabel={t("emptystate.goToLibrary")}
        actionLink="/library"
      />
    );
  }

  return (
    <Stack gap="xl">
      <Grid>
        {cameraRows.length > 0 && (
          <Grid.Col span={{ base: 12, md: 6 }}>
            <Title order={3}>{t("statistics.cameras")}</Title>
            <RankBarList rows={cameraRows} />
          </Grid.Col>
        )}
        {lensRows.length > 0 && (
          <Grid.Col span={{ base: 12, md: 6 }}>
            <Title order={3}>{t("statistics.lenses")}</Title>
            <RankBarList rows={lensRows} />
          </Grid.Col>
        )}
      </Grid>
      <Grid>
        {charts.map(chart => (
          <Grid.Col key={chart.key} span={{ base: 12, md: 6, xl: 4 }}>
            <Stack gap="sm">
              <Title order={3}>{chart.title}</Title>
              <MeasuredBars chart={chart} onSelect={onSelect} />
            </Stack>
          </Grid.Col>
        ))}
      </Grid>
    </Stack>
  );
}
