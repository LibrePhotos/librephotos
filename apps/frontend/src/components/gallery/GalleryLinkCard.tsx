import { Button } from "@mantine/core";
import { IconWorld } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { useGalleryQuery } from "../../api_client/gallery/hooks";
import { SharingRow } from "../sharing/SharingRow";

/**
 * A row of the Sharing overview (SharingRow), while the admin has the public gallery open (#434): the way to it, with
 * how much it shows. Nothing while it is closed (its address answers 404 then).
 */
export function GalleryLinkCard() {
  const { t } = useTranslation();
  const { data: gallery } = useGalleryQuery();
  if (!gallery) return null;
  return (
    <SharingRow
      icon={<IconWorld size={24} stroke={1.5} />}
      title={t("gallery.cardTitle")}
      description={t(gallery.stage === "members" ? "gallery.linkMembers" : "gallery.linkEveryone")}
      action={
        <Button component={Link} to="/public" variant="light" size="sm">
          {t("gallery.open")}
        </Button>
      }
    />
  );
}
