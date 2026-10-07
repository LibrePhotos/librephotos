import { createFileRoute } from "@tanstack/react-router";
import { refresh } from "~/features/auth";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/auth/token/refresh")({
  server: { handlers: { POST: endpoint("none", ({ request }) => refresh(request)) } },
});
