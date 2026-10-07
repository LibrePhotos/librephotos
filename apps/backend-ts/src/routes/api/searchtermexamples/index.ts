import { createFileRoute } from "@tanstack/react-router";
import { searchTermExamples } from "~/features/search/examples";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/searchtermexamples/")({
  server: { handlers: { GET: endpoint("user", ({ user }) => searchTermExamples(user)) } },
});
