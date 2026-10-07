import { createFileRoute } from "@tanstack/react-router";
import { noTimestamp } from "~/features/timeline/lists";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/photos/notimestamp")({
  server: { handlers: { GET: endpoint("user", ({ user, query, request }) => noTimestamp(user, query, request)) } },
});
