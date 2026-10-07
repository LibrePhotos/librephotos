import { createFileRoute } from "@tanstack/react-router";
import { scanPhotos } from "~/features/ingest/triggers";
import { endpoint } from "~/lib/http";

const handler = endpoint("user", ({ user }) => scanPhotos(user, true));

export const Route = createFileRoute("/api/fullscanphotos")({
  server: { handlers: { GET: handler, POST: handler } },
});
