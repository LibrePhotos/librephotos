import { createFileRoute } from "@tanstack/react-router";
import { bulkFlag } from "~/features/photo_edits/bulk";
import { endpoint, jsonBody } from "~/lib/http";

export const Route = createFileRoute("/api/photosedit/setdeleted")({
  server: { handlers: { POST: endpoint("user", async ({ user, request }) => bulkFlag(user, await jsonBody(request), "deleted", "deleted")) } },
});
