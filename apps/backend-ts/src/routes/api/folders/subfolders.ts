import { createFileRoute } from "@tanstack/react-router";
import { subfolders } from "~/features/albums_tags/misc";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/folders/subfolders")({
  server: {
    handlers: {
      GET: endpoint("user", ({ user, query }) => subfolders(user, query)),
    },
  },
});
