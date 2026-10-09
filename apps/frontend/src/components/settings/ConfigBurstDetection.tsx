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
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetchPredefinedBurstRulesQuery } from "../../api_client/settings/hooks/useFetchPredefinedBurstRulesQuery";
import { ModalConfigBurstDetection } from "../modals/ModalConfigBurstDetection";
import type { BurstDetectionRule } from "./burst-detection.zod";
import { SortableTbody, SortableTr } from "./SortableTableRows";

type ConfigBurstDetectionProps = Readonly<{
  value: BurstDetectionRule[] | string | null | undefined;
  onChange: (rules: BurstDetectionRule[]) => void;
}>;

function parseRules(value: BurstDetectionRule[] | string | null | undefined): BurstDetectionRule[] {
  if (!value) return [];
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return [];
    }
  }
  return value;
}

function getRuleExtraInfo(rule: BurstDetectionRule, t: TFunction<"translation", undefined>): string | null {
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
  const [userRules, setUserRules] = useState<BurstDetectionRule[]>([]);
  const [availableRules, setAvailableRules] = useState<BurstDetectionRule[]>([]);
  const [resetButtonDisabled, setResetButtonDisabled] = useState(true);
  const [opened, { open, close }] = useDisclosure(false);

  useEffect(() => {
    // Also an empty list, so that Cancel resets a rule added to a saved list that was empty.
    setUserRules(parseRules(value));
  }, [value]);

  useEffect(() => {
    if (!allRules || !userRules) {
      return;
    }

    // Also with no rules left, so the rule deleted last can be added back.
    setAvailableRules(allRules.filter(rule => !userRules.find(r => r.id === rule.id)));

    const defaultRules = allRules.filter(rule => rule.is_default);
    const defaultRuleIds = defaultRules.map(r => r.id).sort();
    const userRuleIds = userRules.map(r => r.id).sort();
    const defaultEnabled = defaultRules.map(r => ({ id: r.id, enabled: r.enabled }));
    const userEnabled = userRules.map(r => ({ id: r.id, enabled: r.enabled }));

    setResetButtonDisabled(
      JSON.stringify(userRuleIds) === JSON.stringify(defaultRuleIds) &&
        JSON.stringify(userEnabled) === JSON.stringify(defaultEnabled)
    );
  }, [allRules, userRules]);

  function addRules(newRules: BurstDetectionRule[]) {
    const tmp = userRules.concat(newRules);
    setUserRules(tmp);
    onChange(tmp);
  }

  function deleteRule(rule: BurstDetectionRule) {
    const updatedRules = userRules.filter(r => r.id !== rule.id);
    setUserRules(updatedRules);
    onChange(updatedRules);
  }

  function toggleRule(rule: BurstDetectionRule) {
    const updatedRules = userRules.map(r => (r.id === rule.id ? { ...r, enabled: !r.enabled } : r));
    setUserRules(updatedRules);
    onChange(updatedRules);
  }

  // Save the order the list shows after a drop: the dragged rule at its new place and the ones
  // in between shifted by one.
  function moveRule(from: number, to: number) {
    const tmp = arrayMove(userRules, from, to);
    setUserRules(tmp);
    onChange(tmp);
  }

  function resetToDefaultRules() {
    if (!allRules) {
      return;
    }

    const defaultRules = allRules.filter(rule => rule.is_default);
    setUserRules(defaultRules);
    onChange(defaultRules);
  }

  const renderRuleRow = (rule: BurstDetectionRule) => (
    <SortableTr key={rule.id} id={rule.id.toString()}>
      <Table.Td width={60}>
        <Switch checked={rule.enabled} onChange={() => toggleRule(rule)} size="sm" aria-label={rule.name} />
      </Table.Td>
      {/* Only the text dims for a disabled rule: a dimmed switch reads as a disabled control.
          Long tokens such as "MakerNotes:ContinuousDrive" wrap, so the delete button stays in view
          on a phone. */}
      <Table.Td style={{ opacity: rule.enabled ? 1 : 0.6, overflowWrap: "anywhere" }}>
        <Group gap="xs">
          <strong>{rule.name}</strong>
          <Badge size="xs" color={rule.category === "hard" ? "blue" : "orange"}>
            {rule.category === "hard" ? t("settings.burst.hard_criterion") : t("settings.burst.soft_criterion")}
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

      <ModalConfigBurstDetection
        availableRules={availableRules}
        opened={opened}
        onClose={close}
        onAddRules={rules => addRules(rules)}
      />
    </>
  );
}
