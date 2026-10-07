import { createFileRoute } from "@tanstack/react-router";
import { blacklist } from "~/features/auth";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/auth/token/blacklist")({
  server: { handlers: { POST: endpoint("none", ({ request }) => blacklist(request)) } },
});
