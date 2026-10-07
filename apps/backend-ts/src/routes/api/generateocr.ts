import { createFileRoute } from "@tanstack/react-router";
import { generateOcr } from "~/features/jobs/triggers";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/generateocr")({
  server: { handlers: { POST: endpoint("user", ({ user, request }) => generateOcr(user, request)) } },
});
