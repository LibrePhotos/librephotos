import { createFileRoute } from "@tanstack/react-router";
import { sharedFromMe } from "~/features/search/sharing";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/photos/shared/fromme")({
  server: { handlers: { GET: endpoint("user", ({ user, query, request }) => sharedFromMe(user, query, request)) } },
});
