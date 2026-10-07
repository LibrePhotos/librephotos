import { createRootRoute, Outlet } from "@tanstack/react-router";

// API-only server: the React frontend is served elsewhere. The root route
// exists because TanStack Start needs one; it renders nothing useful.
export const Route = createRootRoute({ component: () => <Outlet /> });
