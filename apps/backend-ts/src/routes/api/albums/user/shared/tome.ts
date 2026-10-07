import { createFileRoute } from "@tanstack/react-router";
import { sharedToMe } from "~/features/albums_tags/user_albums";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/albums/user/shared/tome")({
  server: {
    handlers: {
      GET: endpoint("user", ({ user, request, query }) => sharedToMe(user, request, query)),
    },
  },
});
