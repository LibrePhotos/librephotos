import { createFileRoute } from "@tanstack/react-router";
import { getMetadata, patchMetadata } from "~/features/timeline/metadata";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/photos/$id/metadata")({
  server: {
    handlers: {
      GET: endpoint("user", ({ user, params }) => getMetadata(user, params.id)),
      PATCH: endpoint("user", ({ user, params, request }) => patchMetadata(user, params.id, request)),
    },
  },
});
