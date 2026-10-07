import { createFileRoute } from "@tanstack/react-router";
import { healthz } from "~/features/health";

export const Route = createFileRoute("/api/healthz/")({
  server: { handlers: { GET: healthz } },
});
