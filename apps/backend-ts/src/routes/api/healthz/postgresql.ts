import { createFileRoute } from "@tanstack/react-router";
import { postgresql } from "~/features/health";

export const Route = createFileRoute("/api/healthz/postgresql")({
  server: { handlers: { GET: postgresql } },
});
