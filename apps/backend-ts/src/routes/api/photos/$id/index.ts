import { createFileRoute } from "@tanstack/react-router";
import { photoDetail } from "~/features/timeline/detail";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/photos/$id/")({
  server: { handlers: { GET: endpoint("optional", ({ user, params }) => photoDetail(user, params.id)) } },
});
