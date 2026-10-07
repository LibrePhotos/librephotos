import { createFileRoute } from "@tanstack/react-router";
import { persons } from "~/features/sync/sync";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/sync/persons")({
  server: { handlers: { GET: endpoint("user", ({ query, user }) => persons(query, user)) } },
});
