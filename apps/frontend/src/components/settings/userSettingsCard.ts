import type { User } from "@librephotos/api-client";

/**
 * The props of a card on the Settings page: the user as edited so far, and a callback that merges
 * the card's changes into it. Nothing is saved until the page's "Save changes?" dialog says so.
 */
export type UserSettingsCardProps = {
  user: User;
  onChange: (patch: Partial<User>) => void;
};

/** A radio group's value: the stored number as text, or `fallback` while it is 0 or missing. */
export function choiceOf(value: number | undefined, fallback: string): string {
  return value ? value.toString() : fallback;
}
