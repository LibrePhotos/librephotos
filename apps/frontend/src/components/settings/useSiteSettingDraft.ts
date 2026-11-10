import type { SiteSettingsUpdate } from "@librephotos/api-client";
import { useServerDraft } from "../../hooks/useServerDraft";
import { useSaveSiteSettingsAsync } from "./useSaveSiteSettings";

/**
 * One site setting as the admin edits it: the stored value until it is edited, the draft while it
 * is typed or saved (a refetch leaves it alone), and the stored value again once the save settles,
 * whether the server took it or not. `toUpdate` names the field the value is saved as.
 */
export function useSiteSettingDraft<T>(
  stored: T,
  toUpdate: (value: T) => SiteSettingsUpdate,
  isEqual?: (a: T, b: T) => boolean
) {
  const save = useSaveSiteSettingsAsync();
  return useServerDraft(stored, { save: value => save(toUpdate(value)), isEqual });
}
