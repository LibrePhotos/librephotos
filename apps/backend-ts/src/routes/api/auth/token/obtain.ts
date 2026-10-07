import { createFileRoute } from "@tanstack/react-router";
import { obtain } from "~/features/auth";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/auth/token/obtain")({
  server: { handlers: { POST: endpoint("none", ({ request }) => obtain(request)) } },
});
