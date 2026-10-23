import type { LibraryShare } from "@librephotos/api-client";
import { Switch } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";
import { useUpdateLibraryShareMutation } from "../../api_client/libraryShares/hooks";

type Props = Readonly<{ share: LibraryShare; withDescription?: boolean }>;

/** The recipient's one switch (#2731): the owner's photos in my timeline, search and map too. */
export function TimelineSwitch({ share, withDescription = false }: Props) {
  const { t } = useTranslation();
  const update = useUpdateLibraryShareMutation();
  return (
    <Switch
      label={t("librarySharing.showInTimeline")}
      description={withDescription ? t("librarySharing.showInTimelineDesc") : undefined}
      checked={share.show_in_timeline}
      onChange={event => update.mutate({ shareId: share.id, patch: { show_in_timeline: event.currentTarget.checked } })}
    />
  );
}
