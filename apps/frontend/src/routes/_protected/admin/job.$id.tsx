import { createFileRoute } from "@tanstack/react-router";
import React from "react";
import { JobDetailView } from "../../../components/job/JobDetailView";

export const Route = createFileRoute("/_protected/admin/job/$id")();

function AdminJobDetailRoute() {
  const { id } = Route.useParams();

  return <JobDetailView jobId={parseInt(id, 10)} backTo="/admin" />;
}

Route.update({ component: AdminJobDetailRoute });
