import { createFileRoute } from "@tanstack/react-router";
import { destroyPerson, retrievePerson, savePerson } from "~/features/people_faces/persons";
import { endpoint } from "~/lib/http";

export const Route = createFileRoute("/api/persons/$id")({
  server: {
    handlers: {
      GET: endpoint("user", ({ user, params, query }) => retrievePerson(user, params.id, query)),
      PATCH: endpoint("user", ({ user, params, query, request }) => savePerson(user, params.id, query, request, true)),
      PUT: endpoint("user", ({ user, params, query, request }) => savePerson(user, params.id, query, request, false)),
      DELETE: endpoint("user", ({ user, params, query }) => destroyPerson(user, params.id, query)),
    },
  },
});
