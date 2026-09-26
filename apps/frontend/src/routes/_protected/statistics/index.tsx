import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/_protected/statistics/")({
  component: StatisticsIndex,
});

function StatisticsIndex() {
  return <Navigate to="/statistics/placetree" replace />;
}
