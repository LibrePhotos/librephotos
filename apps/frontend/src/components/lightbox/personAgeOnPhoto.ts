import { parsePhotoTimestamp } from "../../util/dateUtils";
import { ageAt, type Age } from "../album/personAge";

/**
 * How old a person was on the day a photo was taken (#3036): null without a birth date or a photo
 * date, or when the photo is older than the birth (no age beats a negative one). The photo's date
 * is the camera's wall clock (`parsePhotoTimestamp`), the day the people on it would name.
 */
export function ageOnPhoto(birthDate: string | null | undefined, takenAt: string | null | undefined): Age | null {
  if (!birthDate || !takenAt) return null;
  const taken = parsePhotoTimestamp(takenAt);
  return taken.isValid ? ageAt(birthDate, taken) : null;
}
