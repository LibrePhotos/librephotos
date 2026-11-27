import { Menu } from "@mantine/core";
import { IconPhotoSearch as PhotoSearch } from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { ICON_SIZE } from "../../uiConstants";

export function FindSimilarPhotosItem({ photoId }: Readonly<{ photoId: string }>) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <Menu.Item
      leftSection={<PhotoSearch size={ICON_SIZE.menu} />}
      onClick={() => void navigate({ to: "/search", search: { similar_to: photoId } })}
    >
      {t("lightbox.toolbar.findSimilar")}
    </Menu.Item>
  );
}
