import { createFileRoute } from "@tanstack/react-router";
import { endpoint } from "~/lib/http";
import { scanFacesEndpoint } from "~/features/tasks/endpoints";

const scan = endpoint("user", ({ user }) => scanFacesEndpoint(user));
export const Route = createFileRoute("/api/scanfaces")({
  server: { handlers: { GET: scan, POST: scan } },
});
