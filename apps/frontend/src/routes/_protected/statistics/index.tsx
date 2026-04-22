import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/_protected/statistics/")();

function StatisticsIndex() {
  return <Navigate to="/statistics/placetree" replace />;
}

Route.update({ component: StatisticsIndex });
