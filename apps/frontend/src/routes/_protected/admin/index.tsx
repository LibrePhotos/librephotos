import { createFileRoute } from "@tanstack/react-router";
import { AdminPage } from "../../../components/settings/AdminPage";

export const Route = createFileRoute("/_protected/admin/")();

function RouteComponent() {
  return <AdminPage />;
}

Route.update({ component: RouteComponent });
