import { createFileRoute } from "@tanstack/react-router";
import { dateList } from "~/features/timeline/dateAlbums";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/albums/date/list")({
  server: { handlers: { GET: endpoint("optional", ({ user, query }) => dateList(user, query)) } },
});
