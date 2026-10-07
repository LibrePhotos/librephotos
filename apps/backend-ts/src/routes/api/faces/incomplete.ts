import { createFileRoute } from "@tanstack/react-router";
import { incompleteFaces } from "~/features/people_faces/faces";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/faces/incomplete")({
  server: { handlers: { GET: endpoint("user", ({ user, query }) => incompleteFaces(user, query)) } },
});
