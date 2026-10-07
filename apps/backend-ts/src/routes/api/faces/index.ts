import { createFileRoute } from "@tanstack/react-router";
import { listFaces } from "~/features/people_faces/faces";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/faces/")({
  server: { handlers: { GET: endpoint("user", ({ user, query, request }) => listFaces(user, query, request)) } },
});
