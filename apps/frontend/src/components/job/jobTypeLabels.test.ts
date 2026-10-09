/**
 * The job list, the job page and the worker indicator translate the backend's
 * English job name with t(job.job_type_str). A name with no key in the English
 * file still renders in English, but Weblate never offers it to translators,
 * so it stays English in every language ("Probe Videos" and eight others did).
 */
import { describe, expect, it } from "vitest";
import translationEn from "../../locales/en/translation.json";

// Mirrors LongRunningJob.JOB_TYPES in apps/backend/api/models/long_running_job.py.
const BACKEND_JOB_TYPE_LABELS = [
  "Scan Photos",
  "Generate Event Albums",
  "Regenerate Event Titles",
  "Train Faces",
  "Delete Missing Photos",
  "Scan Faces",
  "Calculate Clip Embeddings",
  "Find Similar Faces",
  "Download Selected Photos",
  "Download Models",
  "Add Geolocation",
  "Generate Tags",
  "Generate Face Embeddings",
  "Scan Missing Photos",
  "Detect Duplicate Photos",
  "Repair File Variants",
  "Classify Media Categories",
  "Extract Text (OCR)",
  "Probe Videos",
];

describe("job type labels", () => {
  it.each(BACKEND_JOB_TYPE_LABELS)("has an English source string for %s", label => {
    expect((translationEn as Record<string, unknown>)[label]).toBe(label);
  });
});
