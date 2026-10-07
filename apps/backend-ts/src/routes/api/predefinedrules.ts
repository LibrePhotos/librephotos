import { createFileRoute } from "@tanstack/react-router";
import { staticJsonString } from "~/features/users_settings/static_data";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/predefinedrules")({
  server: {
    handlers: {
      GET: endpoint("user", () => staticJsonString("predefinedrules")),
    },
  },
});
