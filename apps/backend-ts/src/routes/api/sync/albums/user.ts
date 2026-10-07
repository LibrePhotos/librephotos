import { createFileRoute } from "@tanstack/react-router";
import { userAlbums } from "~/features/sync/sync";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/sync/albums/user")({
  server: { handlers: { GET: endpoint("user", ({ query, user }) => userAlbums(query, user)) } },
});
