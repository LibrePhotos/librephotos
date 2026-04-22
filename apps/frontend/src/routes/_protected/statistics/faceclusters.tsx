import { createFileRoute } from "@tanstack/react-router";
import { FaceClusterGraph } from "../../../components/charts/FaceClusterGraph";
import { StatisticsNav } from "../../../components/charts/StatisticsNav";

export const Route = createFileRoute("/_protected/statistics/faceclusters")();

function FaceClusters() {
  return (
    <StatisticsNav>
      <FaceClusterGraph height={window.innerHeight - 220} />
    </StatisticsNav>
  );
}

Route.update({ component: FaceClusters });
