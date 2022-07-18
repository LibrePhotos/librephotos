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

export function SortableItem({ item, addItem, addItemFunction, removeItemFunction, id }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: id });
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
            <Title order={4}>{t(`rules.${item.id}`) !== `rules.${item.id}` ? t(`rules.${item.id}`) : item.name}</Title>
            <Text color="dimmed">{t("rules.rule_type", { rule: item.rule_type })}</Text>
            <Text>
              {Object.entries(item)
                .filter(i => i[0] !== "name" && i[0] !== "id" && i[0] !== "rule_type" && i[0] !== "transform_tz")
                .map(prop =>
                  t(`rules.${prop[0]}`, { rule: prop[1] }) !== `rules.${prop[0]}` ? (
                    <li>{t(`rules.${prop[0]}`, { rule: prop[1] })}</li>
                  ) : (
                    <li>
                      {prop[0] as string}: {prop[1] as string}
                    </li>
                  )
                )}
            </Text>
          </Card.Section>
          {!addItem && (
            <div
              style={{
                position: "absolute",
                top: 0,
                right: 0,
                padding: 5,
              }}
              onClick={() => {
                if (removeItemFunction) {
                  removeItemFunction(item);
                }
              }}
            >
              <X />
            </div>
          )}
          {addItem && (
            <Card.Section>
              <Button
                color="green"
                onClick={() => {
                  if (addItemFunction) {
                    addItemFunction(item);
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
