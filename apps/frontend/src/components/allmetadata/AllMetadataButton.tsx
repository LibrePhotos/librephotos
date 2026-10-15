import type { Photo } from "@librephotos/api-client";
import { Anchor, Button } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconListSearch } from "@tabler/icons-react";
import React, { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import classes from "./AllMetadata.module.css";

// Loaded on first open: the dialog, its query and the virtual table are not needed to show the button.
const AllMetadataModal = lazy(async () => ({ default: (await import("./AllMetadataModal")).AllMetadataModal }));

type Props = Readonly<{
  photo: Photo;
  /** A small link in a row of file facts (lightbox), or a button at the end of a card (photo page). */
  variant: "link" | "button";
}>;

function fileNameOf(path: string | undefined): string {
  return path?.split(/[\\/]/).pop() ?? "";
}

/**
 * "All metadata": opens the dialog with every tag of the photo's files. For the photo's owner
 * only, as the editors are: render it where the owner's views render (the lightbox panel when
 * not public, the photo page's owner details). The server answers anyone else with a 404.
 */
export function AllMetadataButton({ photo, variant }: Props) {
  const { t } = useTranslation();
  const [opened, { open, close }] = useDisclosure(false);
  const icon = <IconListSearch size={variant === "link" ? 14 : 16} aria-hidden />;
  return (
    <>
      {variant === "link" ? (
        <Anchor component="button" type="button" size="xs" onClick={open} className={classes.inlineLink}>
          {icon}
          {t("allmetadata.button")}
        </Anchor>
      ) : (
        <Button variant="default" size="xs" leftSection={icon} onClick={open} className={classes.alignStart}>
          {t("allmetadata.button")}
        </Button>
      )}
      {opened && (
        <Suspense fallback={null}>
          <AllMetadataModal opened onClose={close} photoId={photo.id} fileName={fileNameOf(photo.image_path[0])} />
        </Suspense>
      )}
    </>
  );
}
