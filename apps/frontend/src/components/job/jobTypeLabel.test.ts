import { describe, expect, it } from "vitest";
import i18n from "../../i18n";
import { jobTypeLabel } from "./jobTypeLabel";

// LongRunningJob.JOB_TYPES in apps/backend/api/models/long_running_job.py.
const BACKEND_JOB_TYPES: ReadonlyArray<[number, string]> = [
  [1, "Scan Photos"],
  [2, "Generate Event Albums"],
  [3, "Regenerate Event Titles"],
  [4, "Train Faces"],
  [5, "Delete Missing Photos"],
  [6, "Calculate Clip Embeddings"],
  [7, "Scan Faces"],
  [8, "Find Similar Faces"],
  [9, "Download Selected Photos"],
  [10, "Download Models"],
  [11, "Add Geolocation"],
  [12, "Generate Tags"],
  [13, "Generate Face Embeddings"],
  [14, "Scan Missing Photos"],
  [15, "Detect Duplicate Photos"],
  [16, "Repair File Variants"],
  [17, "Classify Media Categories"],
  [18, "Extract Text (OCR)"],
  [19, "Probe Videos"],
  [22, "Detect Stacks"],
  [23, "Remove Photo Details from Thumbnails"],
  [24, "Empty Trash"],
  [25, "Generate Captions"],
  [26, "Apply Date Rules"],
  [27, "Write Metadata to Files"],
  [28, "Read Shutter Speeds Again"],
  [30, "Move Photos"],
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
