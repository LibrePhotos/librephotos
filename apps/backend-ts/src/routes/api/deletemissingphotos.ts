import { createFileRoute } from "@tanstack/react-router";
import { deleteMissingPhotos } from "~/features/jobs/triggers";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/deletemissingphotos")({
  server: {
    handlers: {
      GET: endpoint("user", ({ user }) => deleteMissingPhotos(user)),
      POST: endpoint("user", ({ user }) => deleteMissingPhotos(user)),
    },
  },
});
