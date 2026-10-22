import type { DateTimeRule } from "@librephotos/api-client";
import { ActionIcon, CloseButton, Group, Tooltip } from "@mantine/core";
import { IconCopy as Copy, IconPencil as Pencil } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";

type Props = Readonly<{
  rule: DateTimeRule;
  /** A rule the rule form wrote: it can be edited. Predefined rules stay as they are. */
  custom: boolean;
  /** Whether the rule form can show the rule at all (an exif, path or file time rule). */
  editable: boolean;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}>;

/** A rule row's actions: edit (custom rules), duplicate and edit (predefined ones), delete. */
export function DateRuleRowActions({ rule, custom, editable, onEdit, onDuplicate, onDelete }: Props) {
  const { t } = useTranslation();
  const edit = custom
    ? { label: t("daterules.edit_rule", { name: rule.name }), icon: <Pencil size={18} />, onClick: onEdit }
    : { label: t("daterules.duplicate_rule", { name: rule.name }), icon: <Copy size={18} />, onClick: onDuplicate };
  return (
    <Group gap={4} wrap="nowrap" justify="flex-end">
      {editable && (
        <Tooltip label={edit.label}>
          <ActionIcon variant="subtle" color="gray" aria-label={edit.label} onClick={edit.onClick}>
            {edit.icon}
          </ActionIcon>
        </Tooltip>
      )}
      <CloseButton
        title={t("settings.delete_rule")}
        aria-label={t("settings.delete_rule")}
        size="md"
        onClick={onDelete}
      />
    </Group>
  );
}
