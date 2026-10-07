import { createFileRoute } from "@tanstack/react-router";
import { endpoint } from "~/lib/http";
import { trainFacesEndpoint } from "~/features/tasks/endpoints";

export const Route = createFileRoute("/api/trainfaces")({
  server: { handlers: { POST: endpoint("user", ({ user }) => trainFacesEndpoint(user)) } },
});
