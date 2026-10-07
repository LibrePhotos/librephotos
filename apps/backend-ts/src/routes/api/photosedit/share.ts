import { createFileRoute } from "@tanstack/react-router";
import { sharePhotos } from "~/features/photo_edits/bulk";
import { endpoint, jsonBody } from "~/lib/http";

export const Route = createFileRoute("/api/photosedit/share")({
  server: { handlers: { POST: endpoint("user", async ({ user, request }) => sharePhotos(user, await jsonBody(request))) } },
});
