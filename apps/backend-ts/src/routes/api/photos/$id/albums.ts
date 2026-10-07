import { createFileRoute } from "@tanstack/react-router";
import { photoAlbums } from "~/features/timeline/detail";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/photos/$id/albums")({
  server: { handlers: { GET: endpoint("optional", ({ user, params }) => photoAlbums(user, params.id)) } },
});
