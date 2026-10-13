import { Anchor, Group, Text } from "@mantine/core";
import { IconDatabase, IconFileText } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import type { ParseKeys } from "i18next";
import React from "react";
import { useTranslation } from "react-i18next";
import { useCurrentUserSelfDetailsQuery } from "../../api_client/user/hooks/useCurrentUserSelfDetailsQuery";
import { writeDestination, writeModeOf, type EditedField, type WriteDestination } from "../settings/metadataWrite";
import { SETTINGS_SECTIONS } from "../settings/sectionIds";

const HINT_KEYS: Readonly<Record<WriteDestination, ParseKeys>> = {
  sidecar: "lightbox.sidebar.writeback.sidecar",
  file: "lightbox.sidebar.writeback.file",
  none: "lightbox.sidebar.writeback.none",
};

type Props = Readonly<{
  /** The edit the editor around the hint makes. */
  field: EditedField;
}>;

/**
 * One dimmed line in an editor of the info panel: whether the edit also reaches the photo's file,
 * following the owner's "Write edits to files" (#2281), with a link to that setting.
 * Nothing until the user's settings are loaded, so it never says "only" by mistake.
 */
export function WriteBackHint({ field }: Props) {
  const { t } = useTranslation();
  const { data: user } = useCurrentUserSelfDetailsQuery();
  if (!user) return null;

  const destination = writeDestination(field, writeModeOf(user.save_metadata_to_disk));
  const Icon = destination === "none" ? IconDatabase : IconFileText;
  return (
    <Group gap={6} wrap="nowrap" align="flex-start">
      <Text component="span" c="dimmed" lh={0} mt={3} aria-hidden>
        <Icon size={14} />
      </Text>
      <Text size="xs" c="dimmed">
        {t(HINT_KEYS[destination])}{" "}
        <Anchor size="xs" renderRoot={props => <Link to="/settings" hash={SETTINGS_SECTIONS.metadata} {...props} />}>
          {t("lightbox.sidebar.writeback.settings")}
        </Anchor>
      </Text>
    </Group>
  );
}
