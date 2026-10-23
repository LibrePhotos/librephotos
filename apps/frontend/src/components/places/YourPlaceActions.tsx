import type { UserPlace } from "@librephotos/api-client";
import { ActionIcon, Button, Group, Menu } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconDots, IconPencil, IconTrash } from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { useDeleteUserPlaceMutation } from "../../api_client/albums/hooks";
import { ConfirmModal } from "../modals/ConfirmModal";

type Props = Readonly<{ place: UserPlace }>;

/** A place page's Edit place (the Places map's editor) and Delete place (#1365). */
export function YourPlaceActions({ place }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [confirming, confirm] = useDisclosure(false);
  const remove = useDeleteUserPlaceMutation();

  return (
    <Group gap="xs" wrap="nowrap">
      <Button
        onClick={() => void navigate({ to: "/album/places", search: { edit: place.id } })}
        variant="default"
        size="xs"
        leftSection={<IconPencil size={16} />}
      >
        {t("yourplaces.edit")}
      </Button>
      <Menu position="bottom-end">
        <Menu.Target>
          <ActionIcon variant="subtle" color="gray" aria-label={t("moreactions")}>
            <IconDots size={18} />
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
