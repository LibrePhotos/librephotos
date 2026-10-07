import { createFileRoute } from "@tanstack/react-router";
import { uploadChunk } from "~/features/upload/upload";
import { endpoint } from "~/lib/http";

// Plain Django views: they authenticate themselves (403s, the jwt cookie).
export const Route = createFileRoute("/api/upload/")({
  server: { handlers: { POST: endpoint("none", ({ request }) => uploadChunk(request)) } },
});
