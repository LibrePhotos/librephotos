import { createFileRoute } from "@tanstack/react-router";
import { deleteFaces } from "~/features/people_faces/faces";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/deletefaces")({
  server: { handlers: { POST: endpoint("user", ({ user, request }) => deleteFaces(user, request)) } },
});
