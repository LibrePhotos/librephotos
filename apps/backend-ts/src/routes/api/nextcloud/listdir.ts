import { createFileRoute } from "@tanstack/react-router";
import { listdir } from "~/features/users_settings/nextcloud";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/nextcloud/listdir")({
  server: {
    handlers: {
      GET: endpoint("user", ({ user, query }) => listdir(user, query.nonEmpty("fpath"))),
    },
  },
});
