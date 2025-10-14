import { Divider } from "@mantine/core";
import { createFileRoute } from "@tanstack/react-router";
import { EventCountMonthGraph } from "../../../components/charts/EventCountMonthGraph";
import { LocationDurationStackedBar } from "../../../components/charts/LocationDurationStackedBar";

export const Route = createFileRoute("/_protected/dataviz/timeline")();

export function Timeline() {
  return (
    <div style={{ padding: 10 }}>
      <div>
        <EventCountMonthGraph />
        <Divider hidden />
        <LocationDurationStackedBar />
      </div>
    </div>
  );
}

Route.update({ component: Timeline });
