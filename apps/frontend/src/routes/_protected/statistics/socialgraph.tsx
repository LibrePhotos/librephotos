import { createFileRoute } from "@tanstack/react-router";

import { StatisticsNav } from "../../../components/charts/StatisticsNav";
import { SocialGraph } from "../../../components/charts/SocialGraph";

export const Route = createFileRoute("/_protected/statistics/socialgraph")();

function Graph() {
  return (
    <StatisticsNav>
      <SocialGraph height={window.innerHeight - 220} />
    </StatisticsNav>
  );
}

Route.update({ component: Graph });
