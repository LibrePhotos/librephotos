import { createFileRoute } from "@tanstack/react-router";
import { destroyUser } from "~/features/users_settings/user";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/delete/user/$id")({
  server: {
    handlers: {
      DELETE: endpoint("admin", ({ user, params }) => destroyUser(user, params.id)),
    },
  },
});
