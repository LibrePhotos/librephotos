import { createFileRoute } from "@tanstack/react-router";
import { regenerateTitles } from "~/features/albums_tags/auto_albums";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/autoalbumtitlegen")({
  server: {
    handlers: {
      GET: endpoint("user", ({ user }) => regenerateTitles(user)),
      POST: endpoint("user", ({ user }) => regenerateTitles(user)),
    },
  },
});
