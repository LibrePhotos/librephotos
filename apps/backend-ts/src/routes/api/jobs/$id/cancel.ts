import { createFileRoute } from "@tanstack/react-router";
import { cancelJob } from "~/features/jobs/jobs";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/jobs/$id/cancel")({
  server: { handlers: { POST: endpoint("user", ({ user, query, params }) => cancelJob(user, query, params.id)) } },
});
