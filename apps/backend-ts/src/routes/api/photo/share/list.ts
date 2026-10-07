import { createFileRoute } from "@tanstack/react-router";
import { shareList } from "~/features/search/photoShare";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/photo/share/list")({
  server: { handlers: { GET: endpoint("user", ({ user }) => shareList(user)) } },
});
