import { createFileRoute } from "@tanstack/react-router";
import { tagAlbums } from "~/features/sync/sync";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/sync/albums/tag")({
  server: { handlers: { GET: endpoint("user", ({ query, user }) => tagAlbums(query, user)) } },
});
