import {
  ActionIcon,
  Badge,
  Modal,
  ScrollArea,
  Table,
  Text,
  TextInput,
  Title,
  useComputedColorScheme,
} from "@mantine/core";
import { IconCirclePlus as CirclePlus, IconSearch as Search } from "@tabler/icons-react";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { fuzzyMatch } from "../../util/util";
import type { BurstDetectionRule } from "../settings/burst-detection.zod";

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

function getRuleExtraInfo(rule: BurstDetectionRule): string | null {
  switch (rule.rule_type) {
    case "timestamp_proximity":
      return `Interval: ${rule.interval_ms || 2000}ms`;
    case "visual_similarity":
      return `Threshold: ${rule.similarity_threshold || 15}`;
    case "filename_pattern":
      if (rule.custom_pattern) {
        return `Custom pattern: ${rule.custom_pattern}`;
      }
      return `Pattern type: ${rule.pattern_type || "all"}`;
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
          {getRuleExtraInfo(rule) && (
            <Text size="xs" c="dimmed">
              {getRuleExtraInfo(rule)}
            </Text>
          )}
        </Table.Td>
        <Table.Td width={40}>
          <ActionIcon variant="subtle" color="green" onClick={() => appendRule(rule)}>
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
      opened={opened}
      size="xl"
      title={<Title order={3}>{t("settings.burst.add_rule_title")}</Title>}
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
        <Table highlightOnHover>
          <Table.Tbody>{rules}</Table.Tbody>
        </Table>
      </ScrollArea>
    </Modal>
  );
}
