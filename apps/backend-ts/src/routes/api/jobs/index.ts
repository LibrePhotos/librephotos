import { createFileRoute } from "@tanstack/react-router";
import { listJobs } from "~/features/jobs/jobs";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/jobs/")({
  server: { handlers: { GET: endpoint("user", ({ request, user, query }) => listJobs(request, user, query)) } },
});
