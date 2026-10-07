import { createFileRoute } from "@tanstack/react-router";
import { getSiteSettings, postSiteSettings } from "~/features/users_settings/site_settings";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/sitesettings")({
  server: {
    handlers: {
      GET: endpoint("optional", ({ user }) => getSiteSettings(user)),
      POST: endpoint("admin", ({ user, request }) => postSiteSettings(user, request)),
    },
  },
});
