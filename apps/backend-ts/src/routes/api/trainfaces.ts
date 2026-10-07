import { createFileRoute } from "@tanstack/react-router";
import { trainFaces } from "~/features/people_faces/face_jobs";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/trainfaces")({
  server: { handlers: { POST: endpoint("user", ({ user }) => trainFaces(user)) } },
});
