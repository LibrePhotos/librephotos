import { parsePhotoTimestamp } from "../../util/dateUtils";
import { ageAt, type Age } from "../album/personAge";

export function ageOnPhoto(birthDate: string | null | undefined, takenAt: string | null | undefined): Age | null {
  if (!birthDate || !takenAt) return null;
  const taken = parsePhotoTimestamp(takenAt);
  return taken.isValid ? ageAt(birthDate, taken) : null;
}
