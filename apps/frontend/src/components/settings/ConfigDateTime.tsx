import { arrayMove } from "@dnd-kit/sortable";
import {
  Button,
  CloseButton,
  Group,
  ScrollArea,
  Table,
  Text,
  Title,
  useComputedColorScheme,
  useMantineTheme,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconArrowBackUp as ArrowBackUp, IconCodePlus as CodePlus } from "@tabler/icons-react";
import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetchPredefinedRulesQuery } from "../../api_client/settings/hooks/useFetchPredefinedRulesQuery";
import { ModalConfigDatetime } from "../modals/ModalConfigDatetime";
import { describeRuleType, getRuleExtraInfo } from "./date-time-settings";
import { DateTimeRule } from "./date-time.zod";
import { readSavedList, savedIds, withRuleOrder } from "./savedRuleList";
import { SortableTbody, SortableTr } from "./SortableTableRows";
import { UnreadableSavedEntries } from "./UnreadableSavedEntries";

type ConfigDateTimeProps = Readonly<{
  value: string;
  onChange: (rules: string) => void;
}>;

function isDateTimeRule(entry: unknown): entry is DateTimeRule {
  return DateTimeRule.safeParse(entry).success;
}

export function ConfigDateTime({ value, onChange }: ConfigDateTimeProps) {
  const { t } = useTranslation();
  const theme = useMantineTheme();
  const colorScheme = useComputedColorScheme();
  const { data: allRules } = useFetchPredefinedRulesQuery();
  // Every saved entry: the list shows and edits the rules, and saves the other entries as they are.
  const [entries, setEntries] = useState<unknown[]>([]);
  const userRules = useMemo(() => entries.filter(isDateTimeRule), [entries]);
  const [availableRules, setAvailableRules] = useState<DateTimeRule[]>([]);
  const [resetButtonDisabled, setResetButtonDisabled] = useState(true);
  const [opened, { open, close }] = useDisclosure(false);

  useEffect(() => {
    if (value) {
      setEntries(readSavedList(value));
    }
  }, [value]);

  useEffect(() => {
    if (!allRules) {
      return;
    }

    // Also with no rules left: otherwise the list kept excluding the rule deleted last, and
    // after a reload with no rules the Add Rule dialog was empty.
    const takenIds = savedIds(entries);
    setAvailableRules(allRules.filter(rule => !takenIds.includes(rule.id)));

    // A saved entry that is not a rule also makes the list differ from the defaults.
    const defaultRules = allRules.filter(rule => rule.is_default);
    setResetButtonDisabled(
      entries.length === userRules.length &&
        JSON.stringify(userRules.map(r => r.id)) === JSON.stringify(defaultRules.map(r => r.id))
    );
  }, [allRules, entries, userRules]);

  function save(updatedEntries: unknown[]) {
    setEntries(updatedEntries);
    onChange(JSON.stringify(updatedEntries));
  }

  function addRules(newRules: DateTimeRule[]) {
    save([...entries, ...newRules]);
  }

  function deleteRule(rule: DateTimeRule) {
    save(entries.filter(entry => !(isDateTimeRule(entry) && entry.id === rule.id)));
  }

  // A saved entry the list cannot read as a rule has no id to go by: it goes by its place.
  function deleteEntry(index: number) {
    save(entries.filter((_, i) => i !== index));
  }

  // Rules apply in order, so save the order the list shows after a drop: the dragged rule at
  // its new place and the ones in between shifted by one. An entry the list does not show keeps
  // its place.
  function moveRule(from: number, to: number) {
    save(withRuleOrder(entries, isDateTimeRule, arrayMove(userRules, from, to)));
  }

  // The defaults replace the whole saved list, as they always did.
  function resetToDefaultRules() {
    if (!allRules) {
      return;
    }

    save(allRules.filter(rule => rule.is_default));
  }

  const items = userRules.map(rule => (
    <SortableTr key={rule.id} id={rule.id.toString()}>
      <Table.Td>
        <strong>
          {rule.name} (ID:{rule.id})
        </strong>
        <div
          style={{
            fontSize: "0.9rem",
            color: colorScheme === "dark" ? theme.colors.gray[6] : theme.colors.dark[3],
          }}
        >
          {t("rules.rule_type", { rule: describeRuleType(rule.rule_type, t) })}
        </div>
        {getRuleExtraInfo(rule, t)}
      </Table.Td>
      <Table.Td width={40}>
        <CloseButton
          title={t("settings.delete_rule")}
          aria-label={t("settings.delete_rule")}
          size="md"
          onClick={() => deleteRule(rule)}
        />
      </Table.Td>
    </SortableTr>
  ));

  return (
    <>
      <Title order={4} mb="xs">
        {t("settings.configdatetime")}
      </Title>

      <Text size="sm" c="dimmed" mb="md">
        {t("settings.configdatetime_order_hint")}
      </Text>

      <Group mb="md">
        <Button color="green" leftSection={<CodePlus />} onClick={open}>
          {t("settings.add_rule")}
        </Button>

        <Button
          color={resetButtonDisabled ? "gray" : "red"}
          disabled={resetButtonDisabled}
          leftSection={<ArrowBackUp />}
          onClick={() => resetToDefaultRules()}
        >
          {t("settings.reset_to_defaults")}
        </Button>
      </Group>

      <ScrollArea>
        <Table highlightOnHover>
          <SortableTbody ids={userRules.map(rule => rule.id.toString())} onMove={moveRule}>
            {items}
          </SortableTbody>
        </Table>
      </ScrollArea>

      <UnreadableSavedEntries entries={entries} isRule={isDateTimeRule} onDelete={deleteEntry} />

      <ModalConfigDatetime
        availableRules={availableRules}
        opened={opened}
        onClose={close}
        onAddRules={rules => addRules(rules)}
      />
    </>
  );
}
