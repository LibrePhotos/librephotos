import { createFileRoute } from "@tanstack/react-router";
import { exists } from "~/features/upload/upload";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/exists/$hash")({
  server: { handlers: { GET: endpoint("user", ({ user, params }) => exists(user, params.hash)) } },
});
