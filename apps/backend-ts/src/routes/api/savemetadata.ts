import { createFileRoute } from "@tanstack/react-router";
import { saveMetadata } from "~/features/ingest/metadataBackfill";
import { endpoint, jsonBody } from "~/lib/http";

export const Route = createFileRoute("/api/savemetadata")({
  server: { handlers: { POST: endpoint("user", async ({ user, request }) => saveMetadata(user, await jsonBody(request))) } },
});
