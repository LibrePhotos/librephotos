import { createFileRoute } from "@tanstack/react-router";
import { firstTimeSetup } from "~/features/users_settings/user";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/firsttimesetup")({
  server: {
    handlers: {
      GET: endpoint("optional", () => firstTimeSetup()),
    },
  },
});
