import { createFileRoute } from "@tanstack/react-router";
import { deletePhotos } from "~/features/photo_edits/delete";
import { endpoint, jsonBody } from "~/lib/http";

export const Route = createFileRoute("/api/photosedit/delete")({
  server: { handlers: { DELETE: endpoint("user", async ({ user, request }) => deletePhotos(user, await jsonBody(request))) } },
});
