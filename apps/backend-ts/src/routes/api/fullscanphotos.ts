import { createFileRoute } from "@tanstack/react-router";
import { scan } from "~/features/jobs/triggers";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/fullscanphotos")({
  server: {
    handlers: {
      GET: endpoint("user", ({ user }) => scan(user, true)),
      POST: endpoint("user", ({ user }) => scan(user, true)),
    },
  },
});
