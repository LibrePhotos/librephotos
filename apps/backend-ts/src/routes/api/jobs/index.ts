import { createFileRoute } from "@tanstack/react-router";
import { endpoint } from "~/lib/http";
import { jobsList } from "~/features/tasks/standins";

// Stand-in (tasks branch): see src/features/tasks/standins.ts.
export const Route = createFileRoute("/api/jobs/")({
  server: { handlers: { GET: endpoint("user", ({ user, request, query }) => jobsList(user, request, query)) } },
});
