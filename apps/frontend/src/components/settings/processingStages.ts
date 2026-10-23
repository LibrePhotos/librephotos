import { PROCESSING_STAGE_KEYS } from "@librephotos/api-client";
import type { ProcessingStage, ProcessingStageKey } from "@librephotos/api-client";
import {
  IconCategory,
  IconFaceId,
  IconMapPin,
  IconPhoto,
  IconSearch,
  IconTextCaption,
  IconTextRecognition,
  IconUserScan,
} from "@tabler/icons-react";
import type { Icon } from "@tabler/icons-react";

/** A stage of the processing status this app knows how to show. */
export type KnownStage = ProcessingStage & { key: ProcessingStageKey };

function isKnownKey(key: string): key is ProcessingStageKey {
  return PROCESSING_STAGE_KEYS.some(known => known === key);
}

function isKnownStage(stage: ProcessingStage): stage is KnownStage {
  return isKnownKey(stage.key);
}

/** The stages this app can show; one a newer server adds is left out. */
export function knownStages(stages: ProcessingStage[]): KnownStage[] {
  return stages.filter(isKnownStage);
}

/** Each stage's icon: the one its feature has on the rest of the Library page. */
export const STAGE_ICONS: Record<ProcessingStageKey, Icon> = {
  thumbnails: IconPhoto,
  things: IconCategory,
  search: IconSearch,
  places: IconMapPin,
  face_detection: IconFaceId,
  face_recognition: IconUserScan,
  text: IconTextRecognition,
  captions: IconTextCaption,
};

/** A stage is done when nothing is left and its job is not running. */
export function isStageDone(stage: ProcessingStage): boolean {
  return stage.remaining === 0 && stage.running_job === null;
}
