/**
 * Backward compatibility redirect for /stacks route
 */
import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/_protected/stacks")({
  component: () => <Navigate to="/organizing/$tab" params={{ tab: "stacks" }} replace />,
});
