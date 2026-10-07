import { createFileRoute } from "@tanstack/react-router";
import { rqAvailable } from "~/features/jobs/jobs";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/rqavailable")({
  server: { handlers: { GET: endpoint("user", ({ user }) => rqAvailable(user)) } },
});
