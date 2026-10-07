// The media roots as Django / librephotos-rs spell them: MEDIA_ROOT is
// BASE_DATA joined with protected_media (not normalized), so X-Accel targets
// that carry a filesystem path come out the same.
import { config } from "~/lib/config";
import { pjoin } from "./pyfmt";

export const MEDIA_ROOT = pjoin(config.baseData, "protected_media");
export const ZIP_DIR = pjoin(MEDIA_ROOT, "zip");
export const TRANSCODED_DIR = pjoin(MEDIA_ROOT, "transcoded");
