import { Anchor, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import React from "react";
import { useTranslation } from "react-i18next";
import { ChangeDateTimeModal } from "../photolist/ChangeDateTimeModal";

type Props = Readonly<{
  /** How many photos have no date, said in the dialog's words. */
  message: string;
  /** Their image hashes: "Change date and time…" opens for just these. */
  imageHashes: readonly string[];
  /** Their dates were saved: the preview is read again. */
  onDated: () => void;
}>;

/**
 * The photos a sort or rename by date leaves out because they have no date (#2773, #2774), with a
 * way to give them one without leaving the dialog.
 */
export function UndatedPhotos({ message, imageHashes, onDated }: Props) {
  const { t } = useTranslation();
  const [opened, { open, close }] = useDisclosure(false);
  return (
    <Text size="sm" c="orange">
      {message}{" "}
      {imageHashes.length > 0 && (
        <Anchor component="button" type="button" size="sm" onClick={open}>
          {t("selectionactions.changedatetime")}
        </Anchor>
      )}
      {opened && (
        <ChangeDateTimeModal
          opened
          onClose={close}
          selection={{ image_hashes: [...imageHashes] }}
          onSaved={() => {
            close();
            onDated();
          }}
        />
      )}
    </Text>
  );
}
