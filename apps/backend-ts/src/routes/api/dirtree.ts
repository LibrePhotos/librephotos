import { createFileRoute } from "@tanstack/react-router";
import { dirtree } from "~/features/users_settings/dirtree";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/dirtree")({
  server: {
    handlers: {
      GET: endpoint("admin", ({ query }) => dirtree(query.nonEmpty("path"))),
    },
  },
});
