import { createFileRoute } from "@tanstack/react-router";
import { searchList } from "~/features/search/search";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/photos/searchlist")({
  server: { handlers: { GET: endpoint("user", ({ user, query }) => searchList(user, query)) } },
});
