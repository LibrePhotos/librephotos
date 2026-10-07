import { createFileRoute } from "@tanstack/react-router";
import { labelFaces } from "~/features/people_faces/faces";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/labelfaces")({
  server: { handlers: { POST: endpoint("user", ({ user, request }) => labelFaces(user, request)) } },
});
