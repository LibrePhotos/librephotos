import React, { useState } from "react";
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";

import { SortableItem } from "./SortableItem";
import { useTranslation } from "react-i18next";
import { Header, Button } from "semantic-ui-react";

export function ConfigDatetime() {
  const [items, setItems] = useState([
    {
      id: "1",
      name: "DateTimeOriginal",
      rule_type: "exif",
      exif_tag: "EXIF:DateTimeOriginal",
      transform_tz: 1,
      source_tz: "utc",
      report_tz: "gps_timezonefinder",
    },
    {
      id: "2",
      name: "QuickTime:CreateDate",
      rule_type: "exif",
      exif_tag: "QuickTime:CreateDate",
      transform_tz: 1,
      source_tz: "utc",
      report_tz: "name:Europe/Moscow",
    },
    {
      id: "3",
      name: "Guess Filename",
      rule_type: "filesystem",
      file_property: "mtime",
      transform_tz: 1,
      source_tz: "utc",
      report_tz: "gps_timezonefinder",
    },
  ]);
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );
  const { t } = useTranslation();

  return (
    <div style={{ marginTop: 10 }}>
      <Header as="h3">{t("settings.configdatetime")}</Header>
      <Button color="green" style={{ marginBottom: 10 }}>
        Add Rule{" "}
      </Button>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={items} strategy={verticalListSortingStrategy}>
          {items.map((item) => (
            <SortableItem key={item.id} id={item.id} item={item}></SortableItem>
          ))}
        </SortableContext>
      </DndContext>
    </div>
  );

  function handleDragEnd(event) {
    const { active, over } = event;

    if (active.id !== over.id) {
      setItems((items) => {
        const oldIndex = items.map((i) => i.id).indexOf(active.id);
        const newIndex = items.map((i) => i.id).indexOf(over.id);

        return arrayMove(items, oldIndex, newIndex);
      });
    }
  }
}
