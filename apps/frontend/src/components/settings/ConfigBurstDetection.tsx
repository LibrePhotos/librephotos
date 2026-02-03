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
import React, { useEffect, useState } from "react";
import { DragDropContext, Draggable, Droppable } from "react-beautiful-dnd";
import { useTranslation } from "react-i18next";
import { useFetchPredefinedBurstRulesQuery } from "../../api_client/settings/hooks/useFetchPredefinedBurstRulesQuery";
import { ModalConfigBurstDetection } from "../modals/ModalConfigBurstDetection";
import type { BurstDetectionRule } from "./burst-detection.zod";

type ConfigBurstDetectionProps = Readonly<{
  value: BurstDetectionRule[] | string | null | undefined;
  onChange: (rules: BurstDetectionRule[]) => void;
}>;

function cloneRules(rules: BurstDetectionRule[]): BurstDetectionRule[] {
  // poor man's deep-copy
  return JSON.parse(JSON.stringify(rules));
}

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

function getRuleExtraInfo(rule: BurstDetectionRule): string | null {
  switch (rule.rule_type) {
    case "timestamp_proximity":
      return `Interval: ${rule.interval_ms || 2000}ms${rule.require_same_camera !== false ? ", Same camera required" : ""}`;
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

export function ConfigBurstDetection({ value, onChange }: ConfigBurstDetectionProps) {
  const { t } = useTranslation();
  const colorScheme = useComputedColorScheme();
  const { data: allRules } = useFetchPredefinedBurstRulesQuery();
  const [userRules, setUserRules] = useState<BurstDetectionRule[]>([]);
  const [availableRules, setAvailableRules] = useState<BurstDetectionRule[]>([]);
  const [resetButtonDisabled, setResetButtonDisabled] = useState(true);
  const [opened, { open, close }] = useDisclosure(false);

  useEffect(() => {
    const parsed = parseRules(value);
    if (parsed.length > 0) {
      setUserRules(parsed);
    }
  }, [value]);

  useEffect(() => {
    if (!allRules || !userRules) {
      return;
    }

    if (allRules.length && userRules.length) {
      setAvailableRules(allRules.filter(rule => !userRules.find(r => r.id === rule.id)));
    }

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

  function reorderRules(from: number, to: number) {
    const tmp = cloneRules(userRules);
    [tmp[from], tmp[to]] = [tmp[to], tmp[from]];
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

  const renderRuleRow = (rule: BurstDetectionRule, index: number) => (
    <Draggable key={rule.id} index={index} draggableId={rule.id.toString()}>
      {provided => (
        <Table.Tr
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          style={{
            ...provided.draggableProps.style,
            opacity: rule.enabled ? 1 : 0.6,
          }}
        >
          <Table.Td width={60}>
            <Switch checked={rule.enabled} onChange={() => toggleRule(rule)} size="sm" />
          </Table.Td>
          <Table.Td>
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
            {getRuleExtraInfo(rule) && (
              <Text size="xs" c="dimmed">
                {getRuleExtraInfo(rule)}
              </Text>
            )}
          </Table.Td>
          <Table.Td width={40}>
            <CloseButton title={t("settings.delete_rule")} size="md" onClick={() => deleteRule(rule)} />
          </Table.Td>
        </Table.Tr>
      )}
    </Draggable>
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
        <DragDropContext
          onDragEnd={result => {
            if (result.destination) {
              reorderRules(result.destination.index, result.source.index);
            }
          }}
        >
          <Table highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t("settings.burst.enabled")}</Table.Th>
                <Table.Th>{t("settings.burst.rule")}</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Droppable droppableId="dnd-list" direction="vertical">
              {provided => (
                <Table.Tbody {...provided.droppableProps} ref={provided.innerRef}>
                  {userRules.map((rule, index) => renderRuleRow(rule, index))}
                  {provided.placeholder}
                </Table.Tbody>
              )}
            </Droppable>
          </Table>
        </DragDropContext>
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
