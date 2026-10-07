import { createFileRoute } from "@tanstack/react-router";
import { bulkFlag } from "~/features/photo_edits/bulk";
import { endpoint, jsonBody } from "~/lib/http";

export const Route = createFileRoute("/api/photosedit/hide")({
  server: { handlers: { POST: endpoint("user", async ({ user, request }) => bulkFlag(user, await jsonBody(request), "hidden", "hidden")) } },
});
