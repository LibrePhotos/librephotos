import { createFileRoute } from "@tanstack/react-router";
import { destroyJob, jobDetail } from "~/features/jobs/jobs";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/jobs/$id/")({
  server: {
    handlers: {
      GET: endpoint("user", ({ user, query, params }) => jobDetail(user, query, params.id)),
      DELETE: endpoint("user", ({ user, query, params }) => destroyJob(user, query, params.id)),
    },
  },
});
