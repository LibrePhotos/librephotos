import { createFileRoute } from "@tanstack/react-router";
import { endpoint } from "~/lib/http";
import { searchList } from "~/features/tasks/standins";

// Stand-in (tasks branch): see src/features/tasks/standins.ts.
export const Route = createFileRoute("/api/photos/searchlist")({
  server: { handlers: { GET: endpoint("user", ({ user, query }) => searchList(user, query)) } },
});
