import type { User } from "@librephotos/api-client";

/**
 * The props of a card on the Settings page: the user as edited so far, and a callback that merges
 * the card's changes into it. Nothing is saved until the page's "Save changes?" dialog says so.
 */
export type UserSettingsCardProps = {
  user: User;
  onChange: (patch: Partial<User>) => void;
};
