import React, { useState } from "react";
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";

import { SortableItem } from "./SortableItem";
import { useTranslation } from "react-i18next";
import { Header, Button } from "semantic-ui-react";
import { ModalConfigDatetime } from "../modals/ModalConfigDatetime";
import { useAppDispatch, useAppSelector } from "../../store/store";
import { updateUser } from "../../actions/utilActions";
import { userActions } from "../../store/user/userSlice";
import { selectUserSelfDetails } from "../../store/user/userSelectors";
import { UserSchema } from "../../store/user/user.zod";

export function ConfigDatetime(): JSX.Element {
  const [showModal, setShowModal] = useState(false);
  const { datetime_rules } = useAppSelector(selectUserSelfDetails);
  const userSelfDetails = useAppSelector(selectUserSelfDetails);

  const rules = JSON.parse(datetime_rules ? datetime_rules : "[]");
  //make sure rules have ids
  rules.forEach((rule: any, index: any) => {
    if (!rule.id) {
      rule.id = index;
    }
  });

  const dispatch = useAppDispatch();
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );
  const { t } = useTranslation();

  return (
    <div style={{ marginTop: 10 }}>
      <Header as="h3">{t("settings.configdatetime")}</Header>
      <Button color="green" onClick={() => setShowModal(true)} style={{ marginBottom: 10 }}>
        Add Rule{" "}
      </Button>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={rules} strategy={verticalListSortingStrategy}>
          {rules.map((rule: any) => (
            <SortableItem
              key={rule.id}
              id={rule.id}
              item={rule}
              removeItemFunction={(itemToRemove: any) => {
                const newItems = rules.filter((i: any) => i.id !== itemToRemove.id);
                dispatch(userActions.setRules(JSON.stringify(newItems)));
              }}
            />
          ))}
        </SortableContext>
      </DndContext>

      <ModalConfigDatetime
        isOpen={showModal}
        onRequestClose={() => setShowModal(false)}
        addItemFunction={(item) => {
          if (rules.filter((i: any) => i.id === item.id).length === 0) {
            //dispatch(setRules(newItems));
            setShowModal(false);
            dispatch(userActions.setRules(JSON.stringify([...rules, item])));
          }
        }}
      />
      <Button
        size="small"
        color="green"
        floated="left"
        onClick={() => {
          const newUserData = JSON.parse(JSON.stringify(userSelfDetails));
          delete newUserData.scan_directory;
          delete newUserData.avatar;
          updateUser(newUserData, dispatch);
        }}
      >
        {t("settings.experimentalupdate")}
      </Button>
    </div>
  );

  function handleDragEnd(event: any) {
    const { active, over } = event;

    if (active.id !== over.id) {
      const sortItems = (items: any) => {
        const oldIndex = items.map((i: any) => i.id).indexOf(active.id);
        const newIndex = items.map((i: any) => i.id).indexOf(over.id);

        return arrayMove(items, oldIndex, newIndex);
      };
      dispatch(userActions.setRules(JSON.stringify(sortItems(rules))));
    }
  }
}
