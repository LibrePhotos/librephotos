import { createFileRoute } from "@tanstack/react-router";
import { endpoint, jsonBody } from "~/lib/http";
import { generateIm2txtEndpoint } from "~/features/tasks/endpoints";

export const Route = createFileRoute("/api/photosedit/generateim2txt")({
  server: {
    handlers: { POST: endpoint("optional", async ({ user, request }) => generateIm2txtEndpoint(user, await jsonBody(request))) },
  },
});
