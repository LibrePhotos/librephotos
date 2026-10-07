import { createFileRoute } from "@tanstack/react-router";
import { scanFaces } from "~/features/people_faces/face_jobs";
import { endpoint } from "~/lib/http";

const handler = endpoint("user", ({ user }) => scanFaces(user));
export const Route = createFileRoute("/api/scanfaces")({
  server: { handlers: { GET: handler, POST: handler } },
});
