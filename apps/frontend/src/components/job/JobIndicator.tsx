import {
  IconAlertTriangle as AlertTriangle,
  IconBan as Ban,
  IconCheck as Check,
  IconClock as Clock,
  IconRefresh as Refresh,
} from "@tabler/icons-react";
import React from "react";
import { JOB_OUTCOME_COLOR, jobOutcome, type JobState } from "./jobStatus";

export function JobIndicator({ job }: { job: JobState }) {
  const outcome = jobOutcome(job);
  const color = JOB_OUTCOME_COLOR[outcome];
  switch (outcome) {
    case "failed":
    case "cancelled":
      return <Ban color={color} />;
    case "partial_failure":
      return <AlertTriangle color={color} />;
    case "completed":
      return <Check color={color} />;
    case "running":
      return <Refresh color={color} />;
    default:
      return <Clock color={color} />;
  }
}
