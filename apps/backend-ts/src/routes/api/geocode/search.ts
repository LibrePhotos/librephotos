import { createFileRoute } from "@tanstack/react-router";
import { geocodeSearch } from "~/features/search/geocode";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/geocode/search")({
  server: { handlers: { GET: endpoint("user", ({ query }) => geocodeSearch(query)) } },
});
