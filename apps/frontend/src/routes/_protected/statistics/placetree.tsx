import { createFileRoute } from "@tanstack/react-router";
import { LocationLink } from "../../../components/charts/LocationLink";
import { StatisticsNav } from "../../../components/charts/StatisticsNav";

export const Route = createFileRoute("/_protected/statistics/placetree")();

function PlaceTree() {
  return (
    <StatisticsNav>
      <LocationLink height={window.innerHeight - 220} />
    </StatisticsNav>
  );
}

Route.update({ component: PlaceTree });
