import { createFileRoute } from "@tanstack/react-router";
import { autoAlbums } from "~/features/sync/sync";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/sync/albums/auto")({
  server: { handlers: { GET: endpoint("user", ({ query, user }) => autoAlbums(query, user)) } },
});
