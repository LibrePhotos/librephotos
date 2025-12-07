import { Stack } from "@mantine/core";
import { createFileRoute } from "@tanstack/react-router";

import { StatisticsNav } from "../../../components/charts/StatisticsNav";
import { EventCountMonthGraph } from "../../../components/charts/EventCountMonthGraph";
import { LocationDurationStackedBar } from "../../../components/charts/LocationDurationStackedBar";

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
