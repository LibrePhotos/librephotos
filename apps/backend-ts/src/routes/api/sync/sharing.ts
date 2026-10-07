import { createFileRoute } from "@tanstack/react-router";
import { sharing } from "~/features/sync/sync";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/sync/sharing")({
  server: { handlers: { GET: endpoint("user", ({ query, user }) => sharing(query, user)) } },
});
