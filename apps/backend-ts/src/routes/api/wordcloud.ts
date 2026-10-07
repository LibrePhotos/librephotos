import { createFileRoute } from "@tanstack/react-router";
import { wordCloud } from "~/features/stats_admin_stacks_dupes/stats";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/wordcloud")({
  server: {
    handlers: {
      GET: endpoint("user", ({ user }) => wordCloud(user.id)),
    },
  },
});
