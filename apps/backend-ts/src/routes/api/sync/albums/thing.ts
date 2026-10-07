import { createFileRoute } from "@tanstack/react-router";
import { thingAlbums } from "~/features/sync/sync";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/sync/albums/thing")({
  server: { handlers: { GET: endpoint("user", ({ query, user }) => thingAlbums(query, user)) } },
});
