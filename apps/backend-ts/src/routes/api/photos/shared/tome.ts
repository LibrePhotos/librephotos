import { createFileRoute } from "@tanstack/react-router";
import { sharedToMe } from "~/features/search/sharing";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/photos/shared/tome")({
  server: { handlers: { GET: endpoint("user", ({ user, query, request }) => sharedToMe(user, query, request)) } },
});
