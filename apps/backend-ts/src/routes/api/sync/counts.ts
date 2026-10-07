import { createFileRoute } from "@tanstack/react-router";
import { counts } from "~/features/sync/sync";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/sync/counts")({
  server: { handlers: { GET: endpoint("user", ({ user }) => counts(user)) } },
});
