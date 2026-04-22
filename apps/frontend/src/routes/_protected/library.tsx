import { createFileRoute } from "@tanstack/react-router";
import { Library } from "../../components/settings/Library";

export const Route = createFileRoute("/_protected/library")();

function RouteComponent() {
  return <Library />;
}

Route.update({ component: RouteComponent });
