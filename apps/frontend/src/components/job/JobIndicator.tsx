import React from "react";
import { Ban, Check, Clock, Refresh } from "tabler-icons-react";

import type { IJobDetailSchema } from "../../store/worker/worker.zod";

export function JobIndicator({ job }: { job: IJobDetailSchema }) {
  if (job.finished) {
    return job.failed ? <Ban color="red" /> : <Check color="green" />;
  }
  return job.started_at ? <Refresh color="yellow" /> : <Clock color="blue" />;
}
