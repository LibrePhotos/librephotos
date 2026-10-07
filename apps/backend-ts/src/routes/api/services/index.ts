import { createFileRoute } from "@tanstack/react-router";
import { listServices } from "~/features/jobs/services";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/services/")({
  server: { handlers: { GET: endpoint("admin", () => listServices()) } },
});
