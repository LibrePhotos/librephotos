import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button, Card, Stack, Text, Title } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";
import { X } from "tabler-icons-react";

type Props = {
  item: any;
  id: string;
  addItem?: boolean;
  removeItemFunction?: (id: string) => void;
  addItemFunction?: (item: any) => void;
};

export function SortableItem(props: Props) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: props.id });
  const { t } = useTranslation();
  const style = {
    transform: CSS.Transform.toString(transform),
    marginBottom: 5,
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <Card style={{ width: 325 }}>
        <Stack>
          <Card.Section>
            <Title order={4}>
              {t(`rules.${props.item.id}`) !== `rules.${props.item.id}` ? t(`rules.${props.item.id}`) : props.item.name}
            </Title>
            <Text color="dimmed">{t("rules.rule_type", { rule: props.item.rule_type })}</Text>
            <Text>
              {Object.entries(props.item)
                .filter(i => i[0] !== "name" && i[0] !== "id" && i[0] !== "rule_type" && i[0] !== "transform_tz")
                .map(prop =>
                  t(`rules.${prop[0]}`, { rule: prop[1] }) !== `rules.${prop[0]}` ? (
                    <li>{t(`rules.${prop[0]}`, { rule: prop[1] })}</li>
                  ) : (
                    <li>
                      {prop[0]}: {prop[1]}
                    </li>
                  )
                )}
            </Text>
          </Card.Section>
          {!props.addItem && (
            <div
              style={{
                position: "absolute",
                top: 0,
                right: 0,
                padding: 5,
              }}
              onClick={() => {
                if (props.removeItemFunction) {
                  props.removeItemFunction(props.item);
                }
              }}
            >
              <X />
            </div>
          )}
          {props.addItem && (
            <Card.Section>
              <Button
                color="green"
                onClick={() => {
                  if (props.addItemFunction) {
                    props.addItemFunction(props.item);
                  }
                }}
              >
                Add
              </Button>
            </Card.Section>
          )}
        </Stack>
      </Card>
    </div>
  );
}
