import { createFileRoute, redirect } from "@tanstack/react-router";

// /public on its own (a share link trimmed by hand) rendered an empty page
// under the public header. The timeline, or the login page when logged out.
export const Route = createFileRoute("/public/")({
  beforeLoad: () => {
    throw redirect({ to: "/", replace: true });
  },
});
