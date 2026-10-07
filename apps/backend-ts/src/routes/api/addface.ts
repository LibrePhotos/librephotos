import { createFileRoute } from "@tanstack/react-router";
import { addFace } from "~/features/people_faces/add_face";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/addface")({
  server: { handlers: { POST: endpoint("user", ({ user, request }) => addFace(user, request)) } },
});
