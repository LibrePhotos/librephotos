import { createFileRoute } from "@tanstack/react-router";
import { deleteZip } from "~/features/jobs/zip";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/delete/zip/$fname")({
  server: { handlers: { DELETE: endpoint("user", ({ user, params }) => deleteZip(user, params.fname)) } },
});
