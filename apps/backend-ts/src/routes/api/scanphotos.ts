import { createFileRoute } from "@tanstack/react-router";
import { scanPhotos } from "~/features/ingest/triggers";
import { endpoint } from "~/lib/http";

const handler = endpoint("user", ({ user }) => scanPhotos(user, false));

export const Route = createFileRoute("/api/scanphotos")({
  server: { handlers: { GET: handler, POST: handler } },
});
