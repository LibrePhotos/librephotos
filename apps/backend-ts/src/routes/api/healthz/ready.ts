import { createFileRoute } from "@tanstack/react-router";
import { ready } from "~/features/health";

export const Route = createFileRoute("/api/healthz/ready")({
  server: { handlers: { GET: ready } },
});
