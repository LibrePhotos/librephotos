import { createFileRoute } from "@tanstack/react-router";
import { media } from "~/features/media/view";
import { endpoint } from "~/lib/http";

// Auth is cookie-optional (<img>/<video> send only the jwt cookie), resolved
// inside media() so the hot path checks the user in its photo query.
const handler = endpoint("none", ({ request, url }) => media(request, url));
export const Route = createFileRoute("/media/$")({
  server: { handlers: { GET: handler, HEAD: handler } },
});
