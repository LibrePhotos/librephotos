import { createFileRoute } from "@tanstack/react-router";
import { stopServiceView } from "~/features/jobs/services";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/services/$name/stop")({
  server: { handlers: { POST: endpoint("admin", ({ params }) => stopServiceView(params.name)) } },
});
