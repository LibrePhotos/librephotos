import { createFileRoute } from "@tanstack/react-router";
import { albumBySlug } from "~/features/search/public";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/public/albums/s/$slug/")({
  server: { handlers: { GET: endpoint("optional", ({ params, query }) => albumBySlug(params.slug, query)) } },
});
