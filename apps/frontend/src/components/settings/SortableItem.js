import React from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Item, Card, Label, Icon, Button } from "semantic-ui-react";

export function SortableItem(props) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: props.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    marginBottom: 5,
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <Card style={{ width: 325 }}>
        <Card.Content>
          <Card.Header>{props.item.name}</Card.Header>
          <Card.Meta>Rule Type: {props.item.rule_type}</Card.Meta>
          <Card.Description>
            {props.item.exif_tag ? (
              <li>Use Exiftag {props.item.exif_tag}</li>
            ) : (
              ""
            )}
            {props.item.file_property ? (
              <li>Use file property {props.item.file_property}</li>
            ) : (
              ""
            )}
            {props.item.transform_tz ? (
              <li>
                Transform from {props.item.source_tz} to {props.item.report_tz}
              </li>
            ) : (
              ""
            )}
          </Card.Description>
        </Card.Content>
        {!props.addItem && (
          <Label
            style={{ backgroundColor: "transparent" }}
            attached="top right"
            onClick={() => {
              props.removeItemFunction(props.item);
            }}
          >
            <Icon name="delete" />
          </Label>
        )}
        {props.addItem && (
          <Card.Content extra>
            <Button
              color="green"
              onClick={() => props.addItemFunction(props.item)}
            >
              Add
            </Button>
          </Card.Content>
        )}
      </Card>
    </div>
  );
}
