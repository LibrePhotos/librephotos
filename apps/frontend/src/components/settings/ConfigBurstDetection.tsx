import { arrayMove } from "@dnd-kit/sortable";
import {
  Badge,
  Button,
  CloseButton,
  Group,
  ScrollArea,
  Switch,
  Table,
  Text,
  Title,
  useComputedColorScheme,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconArrowBackUp as ArrowBackUp, IconCodePlus as CodePlus } from "@tabler/icons-react";
import type { TFunction } from "i18next";
import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetchPredefinedBurstRulesQuery } from "../../api_client/settings/hooks/useFetchPredefinedBurstRulesQuery";
import { ModalConfigBurstDetection } from "../modals/ModalConfigBurstDetection";
import { isHardRule, isRuleEnabled, SavedBurstDetectionRule, type BurstDetectionRule } from "./burst-detection.zod";
import { readSavedList, savedIds, withRuleOrder } from "./savedRuleList";
import { SortableTbody, SortableTr } from "./SortableTableRows";
import { UnreadableSavedEntries } from "./UnreadableSavedEntries";

type ConfigBurstDetectionProps = Readonly<{
  /** The user's burst_detection_rules: a list of rules, or the JSON string of one. */
  value: unknown;
  /**
   * The edited list: the rules, and every saved entry that is not one (kept unchanged, in its
   * place), so a save never drops what the page does not show.
   */
  onChange: (entries: unknown[]) => void;
}>;

function isSavedBurstDetectionRule(entry: unknown): entry is SavedBurstDetectionRule {
  return SavedBurstDetectionRule.safeParse(entry).success;
}

function getRuleExtraInfo(rule: SavedBurstDetectionRule, t: TFunction<"translation", undefined>): string | null {
  switch (rule.rule_type) {
    case "timestamp_proximity": {
      const interval = t("settings.burst.rule_interval", { ms: rule.interval_ms || 2000 });
      return rule.require_same_camera !== false ? `${interval}, ${t("settings.burst.rule_same_camera")}` : interval;
    }
    case "visual_similarity":
      return t("settings.burst.rule_threshold", { value: rule.similarity_threshold || 15 });
    case "filename_pattern":
      if (rule.custom_pattern) {
        return t("settings.burst.rule_custom_pattern", { pattern: rule.custom_pattern });
      }
      return t("settings.burst.rule_pattern_type", { type: rule.pattern_type || "all" });
    default:
      return null;
  }
}

export function ConfigBurstDetection({ value, onChange }: ConfigBurstDetectionProps) {
  const { t } = useTranslation();
  const colorScheme = useComputedColorScheme();
  const { data: allRules } = useFetchPredefinedBurstRulesQuery();
  // Every saved entry: the list shows and edits the rules, and saves the other entries as they are.
  const [entries, setEntries] = useState<unknown[]>([]);
  const userRules = useMemo(() => entries.filter(isSavedBurstDetectionRule), [entries]);
  const [availableRules, setAvailableRules] = useState<BurstDetectionRule[]>([]);
  const [resetButtonDisabled, setResetButtonDisabled] = useState(true);
  const [opened, { open, close }] = useDisclosure(false);

  useEffect(() => {
    // Also an empty list, so that Cancel resets a rule added to a saved list that was empty.
    setEntries(readSavedList(value));
  }, [value]);

  useEffect(() => {
    if (!allRules) {
      return;
    }

    // Also with no rules left, so the rule deleted last can be added back.
    const takenIds = savedIds(entries);
    setAvailableRules(allRules.filter(rule => !takenIds.includes(rule.id)));

    const defaultRules = allRules.filter(rule => rule.is_default);
    const defaultRuleIds = defaultRules.map(r => r.id).sort();
    const userRuleIds = userRules.map(r => r.id).sort();
    const defaultEnabled = defaultRules.map(r => ({ id: r.id, enabled: r.enabled }));
    const userEnabled = userRules.map(r => ({ id: r.id, enabled: r.enabled }));

    // A saved entry that is not a rule also makes the list differ from the defaults.
    setResetButtonDisabled(
      entries.length === userRules.length &&
        JSON.stringify(userRuleIds) === JSON.stringify(defaultRuleIds) &&
        JSON.stringify(userEnabled) === JSON.stringify(defaultEnabled)
    );
  }, [allRules, entries, userRules]);

  function save(updatedEntries: unknown[]) {
    setEntries(updatedEntries);
    onChange(updatedEntries);
  }

  function addRules(newRules: BurstDetectionRule[]) {
    save([...entries, ...newRules]);
  }

  function deleteRule(rule: SavedBurstDetectionRule) {
    save(entries.filter(entry => !(isSavedBurstDetectionRule(entry) && entry.id === rule.id)));
  }

  // A saved entry the list cannot read as a rule has no id to go by: it goes by its place.
  function deleteEntry(index: number) {
    save(entries.filter((_, i) => i !== index));
  }

  function toggleRule(rule: SavedBurstDetectionRule) {
    save(
      entries.map(entry =>
        isSavedBurstDetectionRule(entry) && entry.id === rule.id ? { ...entry, enabled: !isRuleEnabled(entry) } : entry
      )
    );
  }

  // Save the order the list shows after a drop: the dragged rule at its new place and the ones
  // in between shifted by one.
  function moveRule(from: number, to: number) {
    save(withRuleOrder(entries, isSavedBurstDetectionRule, arrayMove(userRules, from, to)));
  }

  // The defaults replace the whole saved list, as they always did.
  function resetToDefaultRules() {
    if (!allRules) {
      return;
    }

    save(allRules.filter(rule => rule.is_default));
  }

  const renderRuleRow = (rule: SavedBurstDetectionRule) => (
    <SortableTr key={rule.id} id={rule.id.toString()}>
      <Table.Td width={60}>
        <Switch checked={isRuleEnabled(rule)} onChange={() => toggleRule(rule)} size="sm" aria-label={rule.name} />
      </Table.Td>
      {/* Only the text dims for a disabled rule: a dimmed switch reads as a disabled control.
          Long tokens such as "MakerNotes:ContinuousDrive" wrap, so the delete button stays in view
          on a phone. */}
      <Table.Td style={{ opacity: isRuleEnabled(rule) ? 1 : 0.6, overflowWrap: "anywhere" }}>
        <Group gap="xs">
          <strong>{rule.name}</strong>
          <Badge size="xs" color={isHardRule(rule) ? "blue" : "orange"}>
            {isHardRule(rule) ? t("settings.burst.hard_criterion") : t("settings.burst.soft_criterion")}
          </Badge>
        </Group>
        {rule.description && (
          <Text size="sm" c={colorScheme === "dark" ? "gray.6" : "dark.3"}>
            {rule.description}
          </Text>
        )}
        {getRuleExtraInfo(rule, t) && (
          <Text size="xs" c="dimmed">
            {getRuleExtraInfo(rule, t)}
          </Text>
        )}
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
  );

  return (
    <>
      <Title order={4} mb="xs">
        {t("settings.burst.title")}
      </Title>

      <Text size="sm" c="dimmed" mb="md">
        {t("settings.burst.description")}
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
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t("settings.burst.enabled")}</Table.Th>
              <Table.Th>{t("settings.burst.rule")}</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <SortableTbody ids={userRules.map(rule => rule.id.toString())} onMove={moveRule}>
            {userRules.map(renderRuleRow)}
          </SortableTbody>
        </Table>
      </ScrollArea>

      <UnreadableSavedEntries entries={entries} isRule={isSavedBurstDetectionRule} onDelete={deleteEntry} />

      <ModalConfigBurstDetection
        availableRules={availableRules}
        opened={opened}
        onClose={close}
        onAddRules={rules => addRules(rules)}
      />
    </>
  );
}
