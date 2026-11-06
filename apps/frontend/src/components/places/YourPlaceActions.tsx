import type { UserPlace } from "@librephotos/api-client";
import { ActionIcon, Button, Group, Menu } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconDots, IconPencil, IconTrash } from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { useDeleteUserPlaceMutation } from "../../api_client/albums/hooks";
import { ICON_SIZE, TOOLBAR_ACTION_SIZE, TOOLBAR_CONTROL_HEIGHT } from "../../uiConstants";
import { toolbarLook } from "../common/toolbarLook";
import { ConfirmModal } from "../modals/ConfirmModal";

type Props = Readonly<{ place: UserPlace }>;

/** A place page's Edit place (the Places map's editor) and Delete place (#1365). */
export function YourPlaceActions({ place }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [confirming, confirm] = useDisclosure(false);
  const remove = useDeleteUserPlaceMutation();

  return (
    <Group gap={4} wrap="nowrap">
      <Button
        onClick={() => void navigate({ to: "/album/places", search: { edit: place.id } })}
        {...toolbarLook()}
        h={TOOLBAR_CONTROL_HEIGHT}
        leftSection={<IconPencil size={ICON_SIZE.toolbar} />}
      >
        {t("yourplaces.edit")}
      </Button>
      <Menu position="bottom-end">
        <Menu.Target>
          <ActionIcon {...toolbarLook()} size={TOOLBAR_ACTION_SIZE} aria-label={t("moreactions")}>
            <IconDots size={ICON_SIZE.toolbar} />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item color="red" leftSection={<IconTrash size={16} />} onClick={confirm.open}>
            {t("yourplaces.delete")}
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
      <ConfirmModal
        opened={confirming}
        onClose={confirm.close}
        title={t("yourplaces.deleteTitle", { name: place.name })}
        message={t("yourplaces.deleteMessage", { count: place.photo_count, name: place.name })}
        confirmLabel={t("yourplaces.delete")}
        loading={remove.isPending}
        onConfirm={() =>
          remove.mutate(
            { id: place.id, name: place.name },
            {
              onSuccess: () => {
                confirm.close();
                void navigate({ to: "/album/places" });
              },
            }
          )
        }
      />
    </Group>
  );
}
