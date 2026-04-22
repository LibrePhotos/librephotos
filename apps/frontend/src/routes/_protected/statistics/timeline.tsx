import { Stack } from "@mantine/core";
import { createFileRoute } from "@tanstack/react-router";
import { EventCountMonthGraph } from "../../../components/charts/EventCountMonthGraph";
import { LocationDurationStackedBar } from "../../../components/charts/LocationDurationStackedBar";
import { StatisticsNav } from "../../../components/charts/StatisticsNav";

export const Route = createFileRoute("/_protected/statistics/timeline")();

function Timeline() {
  return (
    <StatisticsNav>
      <Stack gap="xl">
        <EventCountMonthGraph />
        <LocationDurationStackedBar />
      </Stack>
    </StatisticsNav>
  );
}

Route.update({ component: Timeline });
