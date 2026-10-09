import {
  ActionIcon,
  Modal,
  ScrollArea,
  Table,
  Text,
  TextInput,
  useComputedColorScheme,
  useMantineTheme,
} from "@mantine/core";
import { IconCirclePlus as CirclePlus, IconSearch as Search } from "@tabler/icons-react";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { fuzzyMatch } from "../../util/util";
import { getRuleExtraInfo } from "../settings/date-time-settings";
import type { DateTimeRule } from "../settings/date-time.zod";
import { modalTitleStyles } from "./modalTitleStyles";

type Props = Readonly<{
  opened: boolean;
  onClose: () => void;
  onAddRules: (item: any) => void;
  availableRules: DateTimeRule[];
}>;

function searchRules(query: string) {
  return function cb(rule: DateTimeRule) {
    return fuzzyMatch(query, rule.name) || fuzzyMatch(query, rule.rule_type);
  };
}

export function ModalConfigDatetime({ opened, onClose, availableRules, onAddRules }: Props) {
  const { t } = useTranslation();
  const theme = useMantineTheme();
  const colorScheme = useComputedColorScheme();
  const [filter, setFilter] = useState("");
  const [rulesToAdd, setRulesToAdd] = useState<DateTimeRule[]>([]);
  const appendRule = rule => setRulesToAdd([...rulesToAdd, rule]);
  const ignoreSelectedRules = rule => !rulesToAdd.find(r => r.id === rule.id);

  useEffect(() => {
    /**
     * collect rules to add and submit them to the parent when closing the modal
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
      <Table.Tr key={rule.name}>
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
            {t("rules.rule_type", { rule: rule.rule_type })}
          </div>
          {getRuleExtraInfo(rule, t)}
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
      title={t("settings.configdatetime_add_title")}
      onClose={() => onClose()}
    >
      {/* Same gap above the search field as the burst-rule dialog */}
      <Text c="dimmed" mb="md">
        {t("settings.configdatetime_add_description")}
      </Text>
      <ScrollArea>
        <TextInput
          placeholder={t("settings.configdatetime_search_placeholder")}
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
