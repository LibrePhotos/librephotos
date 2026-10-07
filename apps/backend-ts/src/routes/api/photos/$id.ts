import { createFileRoute } from "@tanstack/react-router";
import { endpoint } from "~/lib/http";
import { photoDetail } from "~/features/tasks/standins";

// Stand-in (tasks branch): see src/features/tasks/standins.ts.
export const Route = createFileRoute("/api/photos/$id")({
  server: { handlers: { GET: endpoint("optional", ({ user, params }) => photoDetail(user, params.id)) } },
});
