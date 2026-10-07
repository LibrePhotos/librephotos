import { createFileRoute } from "@tanstack/react-router";
import { media } from "~/features/media/view";
import { endpoint } from "~/lib/http";

// <img>/<video> tags send only the jwt cookie: cookie-optional auth.
const handler = endpoint("cookie-optional", ({ request, url, user }) => media(request, url, user));
export const Route = createFileRoute("/media/$")({
  server: { handlers: { GET: handler, HEAD: handler } },
});
