import { createFileRoute } from "@tanstack/react-router";
import { retrieveUser, updateUserView } from "~/features/users_settings/user";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/user/$id")({
  server: {
    handlers: {
      GET: endpoint("optional", ({ user, params, request }) => retrieveUser(user, params.id, request)),
      PATCH: endpoint("optional", ({ user, params, request }) => updateUserView(user, params.id, request)),
    },
  },
});
