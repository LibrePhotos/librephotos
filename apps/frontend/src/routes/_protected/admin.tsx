import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_protected/admin")();

function AdminLayout() {
  return <Outlet />;
}

Route.update({ component: AdminLayout });
