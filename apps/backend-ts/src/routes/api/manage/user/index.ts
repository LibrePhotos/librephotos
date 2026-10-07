import { createFileRoute } from "@tanstack/react-router";
import { manageList } from "~/features/users_settings/user";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/manage/user/")({
  server: {
    handlers: {
      GET: endpoint("admin", ({ request, url, query }) => manageList(request, url, query)),
    },
  },
});
