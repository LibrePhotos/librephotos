import { createFileRoute } from '@tanstack/react-router'
import { Divider } from '@mantine/core';
import { EventCountMonthGraph } from '../../../components/charts/EventCountMonthGraph';
import { LocationDurationStackedBar } from '../../../components/charts/LocationDurationStackedBar';

export const Route = createFileRoute('/_protected/dataviz/timeline')({
  component: Timeline,
})



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