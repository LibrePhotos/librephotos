import { createFileRoute } from "@tanstack/react-router";
import { rotatePhoto } from "~/features/photo_edits/rotate";
import { endpoint, jsonBody } from "~/lib/http";

export const Route = createFileRoute("/api/photosedit/rotate")({
  server: { handlers: { POST: endpoint("user", async ({ user, request }) => rotatePhoto(user, await jsonBody(request))) } },
});
