import { createFileRoute } from "@tanstack/react-router";
import { placeAlbums } from "~/features/sync/sync";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/sync/albums/place")({
  server: { handlers: { GET: endpoint("user", ({ query, user }) => placeAlbums(query, user)) } },
});
