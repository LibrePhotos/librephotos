import { ActionIcon, Badge, Modal, ScrollArea, Table, Text, TextInput, useComputedColorScheme } from "@mantine/core";
import { IconCirclePlus as CirclePlus, IconSearch as Search } from "@tabler/icons-react";
import type { TFunction } from "i18next";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { fuzzyMatch } from "../../util/util";
import type { BurstDetectionRule } from "../settings/burst-detection.zod";
import { modalTitleStyles } from "./modalTitleStyles";

type Props = Readonly<{
  opened: boolean;
  onClose: () => void;
  onAddRules: (rules: BurstDetectionRule[]) => void;
  availableRules: BurstDetectionRule[];
}>;

function searchRules(query: string) {
  return function cb(rule: BurstDetectionRule) {
    return (
      fuzzyMatch(query, rule.name) ||
      fuzzyMatch(query, rule.rule_type) ||
      fuzzyMatch(query, rule.category) ||
      (rule.description && fuzzyMatch(query, rule.description))
    );
  };
}

function getRuleExtraInfo(rule: BurstDetectionRule, t: TFunction<"translation", undefined>): string | null {
  switch (rule.rule_type) {
    // Same wording as the rule list in ConfigBurstDetection
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

export function ModalConfigBurstDetection({ opened, onClose, availableRules, onAddRules }: Props) {
  const { t } = useTranslation();
  const colorScheme = useComputedColorScheme();
  const [filter, setFilter] = useState("");
  const [rulesToAdd, setRulesToAdd] = useState<BurstDetectionRule[]>([]);
  const appendRule = (rule: BurstDetectionRule) => setRulesToAdd([...rulesToAdd, rule]);
  const ignoreSelectedRules = (rule: BurstDetectionRule) => !rulesToAdd.find(r => r.id === rule.id);

  useEffect(() => {
    /**
     * Collect rules to add and submit them to the parent when closing the modal
     */
    if (!opened && rulesToAdd.length) {
      onAddRules(rulesToAdd);
      setRulesToAdd([]);
    }
  }, [rulesToAdd, opened, onAddRules]);

  const rules = availableRules
    .filter(searchRules(filter))
    .filter(ignoreSelectedRules)
    .map(rule => (
      <Table.Tr key={rule.id}>
        <Table.Td>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <strong>{rule.name}</strong>
            <Badge size="xs" color={rule.category === "hard" ? "blue" : "orange"}>
              {rule.category === "hard" ? t("settings.burst.hard_criterion") : t("settings.burst.soft_criterion")}
            </Badge>
          </div>
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
          <ActionIcon
            variant="subtle"
            color="green"
            aria-label={t("settings.add_rule_named", { name: rule.name })}
            onClick={() => appendRule(rule)}
          >
            <CirclePlus />
          </ActionIcon>
        </Table.Td>
      </Table.Tr>
    ));

  const handleFilterRules = (event: React.ChangeEvent<HTMLInputElement>) => {
    const { value } = event.currentTarget;
    setFilter(value);
  };

  return (
    <Modal
      styles={modalTitleStyles}
      opened={opened}
      size="xl"
      title={t("settings.burst.add_rule_title")}
      onClose={() => onClose()}
    >
      <Text c="dimmed" mb="md">
        {t("settings.burst.add_rule_description")}
      </Text>
      <ScrollArea>
        <TextInput
          placeholder={t("settings.burst.search_placeholder")}
          mb="md"
          leftSection={<Search size={14} />}
          value={filter}
          onChange={e => handleFilterRules(e)}
        />
        {rules.length > 0 && (
          <Table highlightOnHover>
            <Table.Tbody>{rules}</Table.Tbody>
          </Table>
        )}
        {/* An empty table read as a glitch once every rule was in use or the search missed.
            The live region stays mounted so screen readers announce the message as you type. */}
        <div role="status">
          {rules.length === 0 && (
            <Text c="dimmed" ta="center" py="md">
              {availableRules.some(ignoreSelectedRules) ? t("settings.no_rules_match") : t("settings.all_rules_in_use")}
            </Text>
          )}
        </div>
      </ScrollArea>
    </Modal>
  );
}
