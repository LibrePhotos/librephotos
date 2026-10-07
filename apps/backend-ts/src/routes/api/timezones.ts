import { createFileRoute } from "@tanstack/react-router";
import { staticJsonString } from "~/features/users_settings/static_data";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/timezones")({
  server: {
    handlers: {
      GET: endpoint("user", () => staticJsonString("timezones")),
    },
  },
});
