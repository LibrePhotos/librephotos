import { createFileRoute } from "@tanstack/react-router";
import { queue } from "~/features/health";

export const Route = createFileRoute("/api/healthz/queue")({
  server: { handlers: { GET: queue } },
});
