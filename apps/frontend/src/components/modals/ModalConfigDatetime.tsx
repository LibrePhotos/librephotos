import {
  ActionIcon,
  Modal,
  ScrollArea,
  Table,
  Text,
  TextInput,
  Title,
  useMantineColorScheme,
  useMantineTheme,
} from "@mantine/core";
import { IconCirclePlus as CirclePlus, IconSearch as Search } from "@tabler/icons-react";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { fuzzyMatch } from "../../util/util";
import { getRuleExtraInfo } from "../settings/date-time-settings";
import type { DateTimeRule } from "../settings/date-time.zod";

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
  const { colorScheme } = useMantineColorScheme();
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
      title={<Title order={3}>Choose a new rule to add</Title>}
      onClose={() => onClose()}
    >
      <Text c="dimmed">Choose a rule, that will parse the date from a certain field or attribute.</Text>
      <ScrollArea>
        <TextInput
          placeholder="Find rules by name or type..."
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
