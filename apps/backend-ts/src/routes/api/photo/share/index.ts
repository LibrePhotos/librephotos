import { createFileRoute } from "@tanstack/react-router";
import { setShare } from "~/features/search/photoShare";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/photo/share/")({
  server: { handlers: { POST: endpoint("user", ({ user, request }) => setShare(user, request)) } },
});
