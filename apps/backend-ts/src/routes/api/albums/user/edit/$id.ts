import { createFileRoute } from "@tanstack/react-router";
import { editDelete, editRetrieve, editSave } from "~/features/albums_tags/user_albums";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/albums/user/edit/$id")({
  server: {
    handlers: {
      GET: endpoint("user", ({ user, params }) => editRetrieve(user, params.id)),
      PUT: endpoint("user", ({ user, params, request }) => editSave(user, params.id, request, false)),
      PATCH: endpoint("user", ({ user, params, request }) => editSave(user, params.id, request, true)),
      DELETE: endpoint("user", ({ user, params }) => editDelete(user, params.id)),
    },
  },
});
