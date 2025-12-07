import { createFileRoute } from "@tanstack/react-router";

import { StatisticsNav } from "../../../components/charts/StatisticsNav";
import { LocationLink } from "../../../components/charts/LocationLink";

export const Route = createFileRoute("/_protected/statistics/placetree")();

function PlaceTree() {
  return (
    <StatisticsNav>
      <LocationLink height={window.innerHeight - 220} />
    </StatisticsNav>
  );
}

Route.update({ component: PlaceTree });
