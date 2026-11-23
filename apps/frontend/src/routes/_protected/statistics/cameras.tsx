import { createFileRoute } from "@tanstack/react-router";
import { CameraStats } from "../../../components/charts/CameraStats";
import { StatisticsNav } from "../../../components/charts/StatisticsNav";

export const Route = createFileRoute("/_protected/statistics/cameras")({
  component: Cameras,
});

function Cameras() {
  return (
    <StatisticsNav>
      <CameraStats />
    </StatisticsNav>
  );
}
