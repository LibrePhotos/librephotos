import { describe, expect, it } from "vitest";
import i18n from "../../i18n";
import { jobTypeLabel } from "./jobTypeLabel";

// LongRunningJob.JOB_TYPES in apps/backend/api/models/long_running_job.py.
const BACKEND_JOB_TYPES: ReadonlyArray<[number, string]> = [
  [1, "Scan photos"],
  [2, "Generate event albums"],
  [3, "Regenerate event titles"],
  [4, "Train faces"],
  [5, "Delete missing photos"],
  [6, "Calculate CLIP embeddings"],
  [7, "Scan faces"],
  [8, "Find similar faces"],
  [9, "Download selected photos"],
  [10, "Download models"],
  [11, "Add geolocation"],
  [12, "Find things"],
  [13, "Generate face embeddings"],
  [14, "Scan missing photos"],
  [15, "Detect duplicate photos"],
  [16, "Repair file variants"],
  [17, "Classify media categories"],
  [18, "Extract text (OCR)"],
  [19, "Probe videos"],
  [22, "Detect stacks"],
  [23, "Remove photo details from thumbnails"],
  [24, "Empty trash"],
  [25, "Generate captions"],
  [26, "Apply date rules"],
  [27, "Write metadata to files"],
  [28, "Read shutter speeds again"],
  [30, "Move photos"],
  [31, "Remove duplicate faces"],
  [33, "Trash photos outside the library"],
  [34, "Make video posters"],
  [35, "Rename photos"],
  [36, "Repair turned faces"],
];

describe("jobTypeLabel", () => {
  it.each(BACKEND_JOB_TYPES)("names job type %i from its key, %s in English", (jobType, name) => {
    // A key per type, so Weblate offers every one to translators; the server's name is not used.
    expect(jobTypeLabel({ job_type: jobType, job_type_str: "ignored" }, i18n.t)).toBe(name);
  });

  it("still names a type this app does not know, with the server's name", () => {
    expect(jobTypeLabel({ job_type: 99, job_type_str: "Rebuild Index" }, i18n.t)).toBe("Other job (Rebuild Index)");
  });
});
