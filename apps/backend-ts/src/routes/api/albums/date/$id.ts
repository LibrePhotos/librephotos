import { createFileRoute } from "@tanstack/react-router";
import { datePage } from "~/features/timeline/dateAlbums";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/albums/date/$id")({
  server: { handlers: { GET: endpoint("optional", ({ user, params, query }) => datePage(user, params.id, query)) } },
});
