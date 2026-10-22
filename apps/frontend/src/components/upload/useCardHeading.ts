import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import type { ProcessingPhase } from "./uploadProcessing";
import type { UploadProcessing } from "./useUploadProcessing";
import type { UploadItem, UploadStatus } from "./useUploadQueue";

export type Summary = {
  total: number;
  duplicates: number;
  errors: number;
  cancelled: number;
  finished: number;
  uploaded: number;
  pct: number;
};

const isFinished = (status: UploadStatus) => status === "done" || status === "duplicate" || status === "error";

export function summarise(items: UploadItem[]): Summary {
  const count = (status: UploadStatus) => items.filter(i => i.status === status).length;
  const total = items.length;
  const finished = items.filter(i => isFinished(i.status)).length;
  const bytes = items.reduce((acc, i) => acc + i.file.size, 0);
  const sentBytes = items.reduce((acc, i) => acc + i.file.size * (isFinished(i.status) ? 1 : i.progress / 100), 0);
  const ratio = bytes > 0 ? sentBytes / bytes : total > 0 ? finished / total : 0;
  return {
    total,
    duplicates: count("duplicate"),
    errors: count("error"),
    cancelled: count("cancelled"),
    finished,
    uploaded: count("done"),
    pct: Math.round(ratio * 100),
  };
}

/** The card's state for its title, bar and live region. */
export type CardStage = "cancelling" | "uploading" | ProcessingPhase;

export function cardStage(isUploading: boolean, isCancelling: boolean, phase: ProcessingPhase): CardStage {
  if (isCancelling) return "cancelling";
  return isUploading ? "uploading" : phase;
}

type Heading = { title: string; detail: string };

/** "· 2 duplicates · 1 error · 3 cancelled", for what the upload itself left. */
const problems = (summary: Summary, t: TFunction): string =>
  [
    summary.duplicates > 0 && t("upload.duplicates", { count: summary.duplicates }),
    summary.errors > 0 && t("upload.errors", { count: summary.errors }),
    summary.cancelled > 0 && t("upload.cancelled_count", { count: summary.cancelled }),
  ]
    .filter(Boolean)
    .map(text => ` · ${text}`)
    .join("");

function processingHeading(stage: ProcessingPhase, summary: Summary, processing: UploadProcessing, t: TFunction) {
  const { ready, total } = processing.counts;
  const readyCount = t("upload.server.ready_count", { ready, total });
  switch (stage) {
    case "processing":
      return { title: t("upload.server.processing_title"), detail: readyCount + problems(summary, t) };
    case "followups":
      return { title: t("upload.server.followups_title"), detail: `${readyCount} · ${t("upload.server.in_timeline")}` };
    case "done":
      return {
        title: t("upload.server.done_title", { count: ready }),
        detail: t("upload.server.uploaded", { count: summary.uploaded }) + problems(summary, t),
      };
    case "untracked":
      return {
        title: summary.cancelled > 0 ? t("upload.cancelled") : t("upload.complete"),
        detail: t("upload.processed", { finished: summary.finished, total: summary.total }) + problems(summary, t),
      };
  }
}

/** The card's title and the counts under it, for each stage of the upload and its import (#2739). */
export function useCardHeading(stage: CardStage, summary: Summary, processing: UploadProcessing): Heading {
  const { t } = useTranslation();
  if (stage === "cancelling" || stage === "uploading") {
    return {
      title: stage === "cancelling" ? t("upload.cancelling") : t("upload.uploading"),
      detail: t("upload.processed", { finished: summary.finished, total: summary.total }) + problems(summary, t),
    };
  }
  return processingHeading(stage, summary, processing, t);
}
