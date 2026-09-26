import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_protected/admin")({
  component: AdminLayout,
});

function AdminLayout() {
  return <Outlet />;
}
