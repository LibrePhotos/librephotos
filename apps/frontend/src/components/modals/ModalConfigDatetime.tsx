import { Modal, Stack, Text, Title } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import React, { useEffect, useState } from "react";

import { useFetchPredefinedRulesQuery } from "../../api_client/api";
import { useAppSelector } from "../../store/store";
import { selectUserSelfDetails } from "../../store/user/userSelectors";
import { SortableItem } from "../settings/SortableItem";

type Props = {
  isOpen: boolean;
  onRequestClose: () => void;
  addItemFunction: (item: any) => void;
};

export function ModalConfigDatetime(props: Props) {
  const [possibleOptions, setPossibleOptions] = useState<Array<any>>([]);
  const { isLoading, isError, data } = useFetchPredefinedRulesQuery();

  const matches = useMediaQuery("(min-width: 700px)");
  const { datetime_rules } = useAppSelector(selectUserSelfDetails);
  const rules = JSON.parse(datetime_rules || "[]");
  // make sure rules have ids
  rules.forEach((rule: any, index: any) => {
    if (!rule.id) {
      rule.id = index;
    }
  });

  useEffect(() => {
    if (!isLoading && !isError && data !== undefined) {
      setPossibleOptions(data.filter((i: any) => rules.filter((x: any) => x.id == i.id).length == 0));
    }
  }, [isLoading]);

  return (
    <Modal
      opened={props.isOpen}
      title={<Title order={3}>Choose a new rule to add</Title>}
      onClose={() => {
        props.onRequestClose();
      }}
    >
      <Stack>
        <Text color="dimmed">Choose a rule, that will parse the date from a certain field or attribute.</Text>
        <Title order={5}>Rules:</Title>
        {possibleOptions &&
          possibleOptions.map((rule: any) => (
            <SortableItem key={rule.id} id={rule.id} item={rule} addItem addItemFunction={props.addItemFunction} />
          ))}
      </Stack>
    </Modal>
  );
}
