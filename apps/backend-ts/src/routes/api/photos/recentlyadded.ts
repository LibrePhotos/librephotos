import { createFileRoute } from "@tanstack/react-router";
import { recentlyAdded } from "~/features/timeline/lists";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/photos/recentlyadded")({
  server: { handlers: { GET: endpoint("user", ({ user }) => recentlyAdded(user)) } },
});
