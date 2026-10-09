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
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetchPredefinedRulesQuery } from "../../api_client/settings/hooks/useFetchPredefinedRulesQuery";
import { ModalConfigDatetime } from "../modals/ModalConfigDatetime";
import { describeRuleType, getRuleExtraInfo } from "./date-time-settings";
import type { DateTimeRule } from "./date-time.zod";
import { SortableTbody, SortableTr } from "./SortableTableRows";

type ConfigDateTimeProps = Readonly<{
  value: string;
  onChange: (rules: string) => void;
}>;

export function ConfigDateTime({ value, onChange }: ConfigDateTimeProps) {
  const { t } = useTranslation();
  const theme = useMantineTheme();
  const colorScheme = useComputedColorScheme();
  const { data: allRules } = useFetchPredefinedRulesQuery();
  const [userRules, setUserRules] = useState<DateTimeRule[]>([]);
  const [availableRules, setAvailableRules] = useState<DateTimeRule[]>([]);
  const [resetButtonDisabled, setResetButtonDisabled] = useState(true);
  const [opened, { open, close }] = useDisclosure(false);

  useEffect(() => {
    if (value) {
      setUserRules(JSON.parse(value));
    }
  }, [value]);

  useEffect(() => {
    if (!allRules || !userRules) {
      return;
    }

    // Also with no rules left: otherwise the list kept excluding the rule deleted last, and
    // after a reload with no rules the Add Rule dialog was empty.
    setAvailableRules(allRules.filter(rule => !userRules.find(r => r.id === rule.id)));

    const defaultRules = allRules.filter(rule => rule.is_default);
    setResetButtonDisabled(JSON.stringify(userRules.map(r => r.id)) === JSON.stringify(defaultRules.map(r => r.id)));
  }, [allRules, userRules]);

  function addRules(newRules: DateTimeRule[]) {
    const tmp = userRules.concat(newRules);
    setUserRules(tmp);
    onChange(JSON.stringify(tmp));
  }

  function deleteRule(rule: DateTimeRule) {
    const updatedRules = userRules.filter(r => r.id !== rule.id);
    setUserRules(updatedRules);
    onChange(JSON.stringify(updatedRules));
  }

  // Rules apply in order, so save the order the list shows after a drop: the dragged rule at
  // its new place and the ones in between shifted by one.
  function moveRule(from: number, to: number) {
    const tmp = arrayMove(userRules, from, to);
    setUserRules(tmp);
    onChange(JSON.stringify(tmp));
  }

  function resetToDefaultRules() {
    if (!allRules) {
      return;
    }

    const defaultRules = allRules.filter(rule => rule.is_default);
    setUserRules(defaultRules);
    onChange(JSON.stringify(defaultRules));
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

      <ModalConfigDatetime
        availableRules={availableRules}
        opened={opened}
        onClose={close}
        onAddRules={rules => addRules(rules)}
      />
    </>
  );
}
