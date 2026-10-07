import { createFileRoute } from "@tanstack/react-router";
import { generate } from "~/features/albums_tags/auto_albums";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/autoalbumgen")({
  server: {
    handlers: {
      GET: endpoint("user", ({ user }) => generate(user)),
      POST: endpoint("user", ({ user }) => generate(user)),
    },
  },
});
