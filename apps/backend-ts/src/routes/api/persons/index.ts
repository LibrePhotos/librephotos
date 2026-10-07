import { createFileRoute } from "@tanstack/react-router";
import { createPerson, listPersons } from "~/features/people_faces/persons";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/persons/")({
  server: {
    handlers: {
      GET: endpoint("user", ({ user, query, request }) => listPersons(user, query, request)),
      POST: endpoint("user", ({ user, request }) => createPerson(user, request)),
    },
  },
});
