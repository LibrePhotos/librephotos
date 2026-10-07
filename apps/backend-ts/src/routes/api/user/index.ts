import { createFileRoute } from "@tanstack/react-router";
import { createUserView, listUsersView } from "~/features/users_settings/user";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/user/")({
  server: {
    handlers: {
      GET: endpoint("optional", ({ user, request, url, query }) => listUsersView(user, request, url, query)),
      POST: endpoint("optional", ({ user, request }) => createUserView(user, request)),
    },
  },
});
