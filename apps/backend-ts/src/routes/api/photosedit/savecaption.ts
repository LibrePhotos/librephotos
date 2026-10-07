import { createFileRoute } from "@tanstack/react-router";
import { saveCaption } from "~/features/photo_edits/caption";
import { endpoint, jsonBody } from "~/lib/http";

export const Route = createFileRoute("/api/photosedit/savecaption")({
  server: { handlers: { POST: endpoint("optional", async ({ user, request }) => saveCaption(user, await jsonBody(request))) } },
});
