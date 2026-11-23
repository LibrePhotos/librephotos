import { Grid, Stack, Title } from "@mantine/core";
import { useElementSize } from "@mantine/hooks";
import { IconCamera } from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useFetchCameraStatsQuery } from "../../api_client/stats/hooks";
import { EmptyState } from "../common/EmptyState";
import { ErrorState } from "../common/ErrorState";
import { PageLoader } from "../common/PageLoader";
import { useListFailure } from "../common/useListFailure";
import { cameraRows, exposureCharts, lensRows, type ExposureChart } from "./cameraStatsView";
import { DistributionBarChart, type DistributionBar } from "./DistributionBarChart";
import { RankBarList } from "./RankBarList";
import classes from "./StatisticsCharts.module.css";

const RANK_LIMIT = 12;

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

  const onSelect = (bar: DistributionBar) => void navigate({ to: "/search", search: bar.search });

  const cameras = cameraRows(stats?.cameras ?? []);
  const lenses = lensRows(stats?.lenses ?? []);
  const charts = stats ? exposureCharts(stats, t) : [];

  if (isLoading) return <PageLoader />;
  if (listFailure) return <ErrorState failure={listFailure} />;
  if (cameras.length + lenses.length + charts.length === 0) {
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
        {cameras.length > 0 && (
          <Grid.Col span={{ base: 12, md: 6 }}>
            <Title order={3}>{t("statistics.cameras")}</Title>
            <RankBarList rows={cameras} limit={RANK_LIMIT} />
          </Grid.Col>
        )}
        {lenses.length > 0 && (
          <Grid.Col span={{ base: 12, md: 6 }}>
            <Title order={3}>{t("statistics.lenses")}</Title>
            <RankBarList rows={lenses} limit={RANK_LIMIT} />
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
