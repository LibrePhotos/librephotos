import { createFileRoute } from "@tanstack/react-router";
import { albumPhotoBySlug } from "~/features/search/public";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/public/albums/s/$slug/photos/$photoId")({
  server: { handlers: { GET: endpoint("optional", ({ params }) => albumPhotoBySlug(params.slug, params.photoId)) } },
});
