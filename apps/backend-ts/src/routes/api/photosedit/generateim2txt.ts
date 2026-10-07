import { createFileRoute } from "@tanstack/react-router";
import { generateIm2txt } from "~/features/photo_edits/caption";
import { endpoint, jsonBody } from "~/lib/http";

export const Route = createFileRoute("/api/photosedit/generateim2txt")({
  server: { handlers: { POST: endpoint("optional", async ({ user, request }) => generateIm2txt(user, await jsonBody(request))) } },
});
