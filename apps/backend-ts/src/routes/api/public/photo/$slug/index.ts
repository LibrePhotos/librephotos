import { createFileRoute } from "@tanstack/react-router";
import { photoBySlug } from "~/features/search/public";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/public/photo/$slug/")({
  server: { handlers: { GET: endpoint("optional", ({ params }) => photoBySlug(params.slug)) } },
});
