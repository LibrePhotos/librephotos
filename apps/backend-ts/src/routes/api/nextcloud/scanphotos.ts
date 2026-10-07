import { createFileRoute } from "@tanstack/react-router";
import { scanphotos } from "~/features/users_settings/nextcloud";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/nextcloud/scanphotos")({
  server: {
    handlers: {
      GET: endpoint("user", ({ user }) => scanphotos(user)),
      POST: endpoint("user", ({ user }) => scanphotos(user)),
    },
  },
});
