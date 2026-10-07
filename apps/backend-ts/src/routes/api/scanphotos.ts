import { createFileRoute } from "@tanstack/react-router";
import { scan } from "~/features/jobs/triggers";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/scanphotos")({
  server: {
    handlers: {
      GET: endpoint("user", ({ user }) => scan(user, false)),
      POST: endpoint("user", ({ user }) => scan(user, false)),
    },
  },
});
