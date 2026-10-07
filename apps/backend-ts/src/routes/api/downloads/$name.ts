import { createFileRoute } from "@tanstack/react-router";
import { download } from "~/features/media/downloads";
import { endpoint } from "~/lib/http";

const handler = endpoint("cookie", ({ request, params, user }) => download(request, user, params.name!));
export const Route = createFileRoute("/api/downloads/$name")({
  server: { handlers: { GET: handler, HEAD: handler } },
});
