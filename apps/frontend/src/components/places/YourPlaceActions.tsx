import type { UserPlace } from "@librephotos/api-client";
import { Menu } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconPencil, IconTrash } from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { useDeleteUserPlaceMutation } from "../../api_client/albums/hooks";
import { ICON_SIZE } from "../../uiConstants";
import { ConfirmModal } from "../modals/ConfirmModal";
import { HeaderActionsMenu } from "../photolist/HeaderActionsMenu";

type Props = Readonly<{ place: UserPlace }>;

/** A place page's ⋯: Edit place (the Places map's editor) and Delete place (#1365). */
export function YourPlaceActions({ place }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [confirming, confirm] = useDisclosure(false);
  const remove = useDeleteUserPlaceMutation();

  return (
    <>
      <HeaderActionsMenu label={t("moreactions")}>
        <Menu.Item
          leftSection={<IconPencil size={ICON_SIZE.menu} />}
          onClick={() => void navigate({ to: "/album/places", search: { edit: place.id } })}
        >
          {t("yourplaces.edit")}
        </Menu.Item>
        <Menu.Divider />
        <Menu.Item color="red" leftSection={<IconTrash size={ICON_SIZE.menu} />} onClick={confirm.open}>
          {t("yourplaces.delete")}
        </Menu.Item>
      </HeaderActionsMenu>
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
    </>
  );
}
