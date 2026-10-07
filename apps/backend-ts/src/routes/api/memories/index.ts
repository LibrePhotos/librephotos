import { createFileRoute } from "@tanstack/react-router";
import { memories } from "~/features/timeline/memories";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/memories/")({
  server: { handlers: { GET: endpoint("user", ({ user, query }) => memories(user, query)) } },
});
