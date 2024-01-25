import { Button, CloseButton, Group, ScrollArea, Table, Title } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconArrowBackUp as ArrowBackUp, IconCodePlus as CodePlus } from "@tabler/icons-react";
import React, { useEffect, useState } from "react";
import { DragDropContext, Draggable, Droppable } from "react-beautiful-dnd";
import { useTranslation } from "react-i18next";

import { useFetchPredefinedRulesQuery } from "../../api_client/api";
import { ModalConfigDatetime } from "../modals/ModalConfigDatetime";
import { getRuleExtraInfo, useDateTimeSettingsStyles } from "./date-time-settings";
import type { DateTimeRule } from "./date-time.zod";

type ConfigDateTimeProps = Readonly<{
  value: string;
  onChange: (rules: string) => void;
}>;

function cloneRules(rules: DateTimeRule[]): DateTimeRule[] {
  // poor man's deep-copy
  return JSON.parse(JSON.stringify(rules));
}

export function ConfigDateTime({ value, onChange }: ConfigDateTimeProps) {
  const { t } = useTranslation();
  const { classes } = useDateTimeSettingsStyles();
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

    if (allRules.length && userRules.length) {
      setAvailableRules(allRules.filter(rule => !userRules.find(r => r.id === rule.id)));
    }

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

  function reorderRules(from: number, to: number) {
    const tmp = cloneRules(userRules);
    [tmp[from], tmp[to]] = [tmp[to], tmp[from]];
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

  const items = userRules.map((rule, index) => (
    <Draggable key={rule.id} index={index} draggableId={rule.id.toString()}>
      {provided => (
        // eslint-disable-next-line react/jsx-props-no-spreading
        <tr className={classes.item} ref={provided.innerRef} {...provided.draggableProps} {...provided.dragHandleProps}>
          <td>
            <strong>
              {rule.name} (ID:{rule.id})
            </strong>
            <div className={classes.rule_type}>{t("rules.rule_type", { rule: rule.rule_type })}</div>
            {getRuleExtraInfo(rule, t)}
          </td>
          <td width={40}>
            <CloseButton title="Delete rule" size="md" onClick={() => deleteRule(rule)} />
          </td>
        </tr>
      )}
    </Draggable>
  ));

  return (
    <>
      <Title order={4} sx={{ marginBottom: 16 }}>
        {t("settings.configdatetime")}
      </Title>

      <Group>
        <Button color="green" leftIcon={<CodePlus />} onClick={open} style={{ marginBottom: 10 }}>
          {t("settings.add_rule")}
        </Button>

        <Button
          color={resetButtonDisabled ? "gray" : "red"}
          disabled={resetButtonDisabled}
          leftIcon={<ArrowBackUp />}
          onClick={() => resetToDefaultRules()}
          style={{ marginBottom: 10 }}
        >
          Reset To Defaults
        </Button>
      </Group>

      <ScrollArea>
        <DragDropContext onDragEnd={result => reorderRules(result.destination?.index || 0, result.source.index)}>
          <Table>
            <Droppable droppableId="dnd-list" direction="vertical">
              {provided => (
                // eslint-disable-next-line react/jsx-props-no-spreading
                <tbody {...provided.droppableProps} ref={provided.innerRef}>
                  {items}
                  {provided.placeholder}
                </tbody>
              )}
            </Droppable>
          </Table>
        </DragDropContext>
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
