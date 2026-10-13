import { UNKNOWN_PERSON_NAME } from "@librephotos/api-client";
import { deburr } from "lodash-es";

/** The alphabet marker a label sorts under: its first letter, "#" for a digit, ":-)" for anything else. */
export function alphabetMarkerLetter(label: string): string {
  const firstChar = deburr(label.charAt(0)).toUpperCase();
  if (firstChar !== firstChar.toLowerCase()) return firstChar;
  return /^\d$/.test(firstChar) ? "#" : ":-)";
}

/** The unknown group keeps its own marker, spelled out, instead of a letter. */
export const isUnknownPersonLabel = (label: string) => label === UNKNOWN_PERSON_NAME;
