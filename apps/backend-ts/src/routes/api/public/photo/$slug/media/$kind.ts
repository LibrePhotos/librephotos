import { createFileRoute } from "@tanstack/react-router";
import { publicPhotoMedia } from "~/features/media/public";
import { endpoint } from "~/lib/http";

// Authentication still runs (a bad bearer token is a 401, as on Django).
const handler = endpoint("cookie-optional", ({ request, params }) => publicPhotoMedia(request, params.slug!, params.kind!));
export const Route = createFileRoute("/api/public/photo/$slug/media/$kind")({
  server: { handlers: { GET: handler, HEAD: handler } },
});
