import { createFileRoute } from "@tanstack/react-router";
import { SocialGraph } from "../../../components/charts/SocialGraph";
import { StatisticsNav } from "../../../components/charts/StatisticsNav";

export const Route = createFileRoute("/_protected/statistics/socialgraph")();

function Graph() {
  return (
    <StatisticsNav>
      <SocialGraph height={window.innerHeight - 220} />
    </StatisticsNav>
  );
}

Route.update({ component: Graph });
