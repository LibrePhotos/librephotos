import { createFileRoute } from "@tanstack/react-router";
import { pollDownload, startDownload } from "~/features/jobs/zip";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/photos/download")({
  server: {
    handlers: {
      GET: endpoint("user", ({ user, query }) => pollDownload(user, query)),
      POST: endpoint("user", ({ user, request }) => startDownload(user, request)),
    },
  },
});
