import { createFileRoute } from "@tanstack/react-router";
import React from "react";
import { JobDetailView } from "../../../components/job/JobDetailView";

export const Route = createFileRoute("/_protected/jobs/$id")();

function UserJobDetailRoute() {
  const { id } = Route.useParams();

  return <JobDetailView jobId={parseInt(id, 10)} backTo="/jobs" />;
}

Route.update({ component: UserJobDetailRoute });
