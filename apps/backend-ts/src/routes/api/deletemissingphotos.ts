import { createFileRoute } from "@tanstack/react-router";
import { deleteMissingPhotos } from "~/features/ingest/triggers";
import { endpoint } from "~/lib/http";

const handler = endpoint("user", ({ user }) => deleteMissingPhotos(user));

export const Route = createFileRoute("/api/deletemissingphotos")({
  server: { handlers: { GET: handler, POST: handler } },
});
