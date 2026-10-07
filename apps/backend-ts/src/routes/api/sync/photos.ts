import { createFileRoute } from "@tanstack/react-router";
import { photos } from "~/features/sync/sync";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/sync/photos")({
  server: { handlers: { GET: endpoint("user", ({ query, user }) => photos(query, user)) } },
});
