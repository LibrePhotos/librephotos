import type { MantineColor } from "@mantine/core";
import { Button, Modal, Stack, Text } from "@mantine/core";
import React from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import classes from "./ConfirmModal.module.css";
import { modalTitleStyles } from "./modalTitleStyles";

type Props = Readonly<{
  opened: boolean;
  onClose: () => void;
  onConfirm: () => void;
  /** A question naming the action: "Delete this face?". */
  title: string;
  /** What is lost, in a sentence or two, naming what is acted on. */
  message: ReactNode;
  /** Repeats the verb of the title: "Delete face", never "OK" or "Confirm". */
  confirmLabel: string;
  /** "Cancel" unless that is ambiguous next to the confirm label ("Keep running" beside "Cancel job"). */
  cancelLabel?: string;
  /** The confirm button's colour: red for a destructive action, the theme's for a long one (#524). */
  confirmColor?: MantineColor;
  /** Adds the red "This action cannot be undone." line. */
  irreversible?: boolean;
  /**
   * The action is running: both buttons, Escape and the overlay are locked, and the
   * dialog stays open until the caller closes it (in the mutation's onSuccess).
   */
  loading?: boolean;
}>;

/**
 * Ask before a destructive one-click action (#2223). The red button runs `onConfirm`;
 * Cancel, Escape, the close button and the overlay only call `onClose`. Focus starts on
 * Cancel, so an Enter right after a misclick does nothing harmful.
 *
 * Inside a Menu.Dropdown the dialog would unmount with the menu: render it next to the
 * Menu and open it from the item. Above another Modal, switch that modal's
 * `closeOnEscape` off while this one is open, or Escape closes both.
 */
export function ConfirmModal({
  opened,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel,
  cancelLabel,
  confirmColor = "red",
  irreversible = false,
  loading = false,
}: Props) {
  const { t } = useTranslation();

  return (
    <Modal
      styles={modalTitleStyles}
      // Above the lightbox, like the other dialogs it opens.
      zIndex={1500}
      opened={opened}
      onClose={onClose}
      title={title}
      centered
      size="md"
      closeOnClickOutside={!loading}
      closeOnEscape={!loading}
      withCloseButton={!loading}
    >
      <Stack gap="sm">
        <Text size="sm">{message}</Text>
        {irreversible && (
          <Text size="sm" c="red">
            {t("confirmdialog.cannotbeundone")}
          </Text>
        )}
        <div className={classes.actions}>
          <Button variant="default" onClick={onClose} disabled={loading} data-autofocus>
            {cancelLabel ?? t("cancel")}
          </Button>
          <Button color={confirmColor} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </div>
      </Stack>
    </Modal>
  );
}
