import { createFileRoute } from "@tanstack/react-router";
import { serviceStatus } from "~/features/jobs/services";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/services/$name/")({
  server: { handlers: { GET: endpoint("admin", ({ params }) => serviceStatus(params.name)) } },
});
