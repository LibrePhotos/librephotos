import { createFileRoute } from "@tanstack/react-router";
import { Settings } from "../../components/settings/Settings";

export const Route = createFileRoute("/_protected/settings")();

function RouteComponent() {
  return <Settings />;
}

Route.update({ component: RouteComponent });
