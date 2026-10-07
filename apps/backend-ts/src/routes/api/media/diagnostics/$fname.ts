import { createFileRoute } from "@tanstack/react-router";
import { diagnostics } from "~/features/media/diagnostics";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/media/diagnostics/$fname")({
  server: { handlers: { GET: endpoint("admin", ({ params }) => diagnostics(params.fname!)) } },
});
