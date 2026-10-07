import { createFileRoute } from "@tanstack/react-router";
import { manageRetrieve, manageUpdate } from "~/features/users_settings/user";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/manage/user/$id")({
  server: {
    handlers: {
      GET: endpoint("admin", ({ params }) => manageRetrieve(params.id)),
      PATCH: endpoint("admin", ({ params, request }) => manageUpdate(params.id, request)),
    },
  },
});
