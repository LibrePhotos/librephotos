import React from "react";
import { Ban, Check, Clock, Refresh } from "tabler-icons-react";

import type { IJob } from "../../actions/utilActions.types";

export function JobIndicator({ job }: { job: IJob }) {
  if (job.finished) {
    return job.failed ? <Ban color="red" /> : <Check color="green" />;
  }
  return job.started_at ? <Refresh color="yellow" /> : <Clock color="blue" />;
}
