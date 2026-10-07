import { createFileRoute } from "@tanstack/react-router";
import { startServiceView } from "~/features/jobs/services";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/services/$name/start")({
  server: { handlers: { POST: endpoint("admin", ({ params }) => startServiceView(params.name)) } },
});
