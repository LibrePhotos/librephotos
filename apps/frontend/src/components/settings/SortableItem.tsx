import React from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Card, Label, Icon, Button } from "semantic-ui-react";
import { useTranslation } from "react-i18next";

type Props = {
  item: any;
  id: string;
  addItem?: boolean;
  removeItemFunction?: (id: string) => void;
  addItemFunction?: (item: any) => void;
};

export function SortableItem(props: Props) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: props.id });
  const { t } = useTranslation();
  const style = {
    transform: CSS.Transform.toString(transform),
    marginBottom: 5,
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <Card style={{ width: 400 }}>
        <Card.Content>
          <Card.Header>{props.item.name}</Card.Header>
          <Card.Meta>Rule Type: {props.item.rule_type}</Card.Meta>
          <Card.Description>
            {Object.entries(props.item)
              .filter(
                (i) =>
                  i[0] !== "name" &&
                  i[0] !== "rule_type" &&
                  i[0] !== "transform_tz"
              )
              .map((prop) =>
                t("rules." + prop[0], { rule: prop[1] }) !==
                "rules." + prop[0] ? (
                  <li>{t("rules." + prop[0], { rule: prop[1] })}</li>
                ) : (
                  <li>
                    {prop[0]}: {prop[1]}
                  </li>
                )
              )}
          </Card.Description>
        </Card.Content>
        {!props.addItem && (
          <Label
            style={{ backgroundColor: "transparent" }}
            attached="top right"
            onClick={() => {
              if (props.removeItemFunction) {
                props.removeItemFunction(props.item);
              }
            }}
          >
            <Icon name="delete" />
          </Label>
        )}
        {props.addItem && (
          <Card.Content extra>
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
          </Card.Content>
        )}
      </Card>
    </div>
  );
}
