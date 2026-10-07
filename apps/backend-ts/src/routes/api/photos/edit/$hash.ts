import { createFileRoute } from "@tanstack/react-router";
import { patchPhoto } from "~/features/photo_edits/edit";
import { endpoint, jsonBody } from "~/lib/http";

export const Route = createFileRoute("/api/photos/edit/$hash")({
  server: { handlers: { PATCH: endpoint("user", async ({ user, request, params }) => patchPhoto(user, params.hash, await jsonBody(request))) } },
});
