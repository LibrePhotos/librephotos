import { createFileRoute } from "@tanstack/react-router";
import { clusterFaces } from "~/features/people_faces/face_jobs";
import { endpoint } from "~/lib/http";

const handler = endpoint("user", ({ user }) => clusterFaces(user));
export const Route = createFileRoute("/api/clusterfaces")({
  server: { handlers: { GET: handler, POST: handler } },
});
