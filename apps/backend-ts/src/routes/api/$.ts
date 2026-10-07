import { createFileRoute } from "@tanstack/react-router";
import { ApiError } from "~/lib/errors";

// Unknown /api/* paths: a JSON 404 instead of the router's HTML page.
const notFound = () => ApiError.notFound().toResponse();
export const Route = createFileRoute("/api/$")({
  server: { handlers: { GET: notFound, POST: notFound, PUT: notFound, PATCH: notFound, DELETE: notFound, HEAD: notFound } },
});
