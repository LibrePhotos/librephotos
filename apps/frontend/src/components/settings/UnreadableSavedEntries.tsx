import { CloseButton, Code, Table, Text } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";

type UnreadableSavedEntriesProps = Readonly<{
  /** Every saved entry, rules and the rest, in the saved order. */
  entries: readonly unknown[];
  /** Whether the page reads an entry as a rule (and lists it with the rules). */
  isRule: (entry: unknown) => boolean;
  /** Remove the saved entry at this index. */
  onDelete: (index: number) => void;
}>;

/**
 * The saved entries the page cannot read as rules (a rule type added later, or a rule a script
 * saved without a key the page needs). The server may still apply one: it fills in what a rule
 * leaves out. So each is listed, read-only, with its place in the saved list and its JSON, and can
 * be deleted. Toggling and reordering stay with the rules the page reads.
 */
export function UnreadableSavedEntries({ entries, isRule, onDelete }: UnreadableSavedEntriesProps) {
  const { t } = useTranslation();
  const unreadable = entries.flatMap((entry, index) => (isRule(entry) ? [] : [{ entry, index }]));
  if (unreadable.length === 0) {
    return null;
  }

  return (
    <>
      <Text size="sm" c="dimmed" mt="md" mb="xs">
        {t("settings.unreadable_rules_hint")}
      </Text>
      <Table>
        <Table.Tbody>
          {unreadable.map(({ entry, index }) => (
            <Table.Tr key={index} data-testid="unreadable-saved-entry">
              <Table.Td style={{ overflowWrap: "anywhere" }}>
                <strong>{t("settings.unreadable_rule", { position: index + 1 })}</strong>
                <Code block mt={4}>
                  {JSON.stringify(entry)}
                </Code>
              </Table.Td>
              <Table.Td width={40}>
                <CloseButton
                  title={t("settings.delete_rule")}
                  aria-label={t("settings.delete_rule")}
                  size="md"
                  onClick={() => onDelete(index)}
                />
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </>
  );
}
