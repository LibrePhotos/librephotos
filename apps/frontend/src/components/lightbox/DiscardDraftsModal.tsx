import type { ParseKeys } from "i18next";
import React from "react";
import { useTranslation } from "react-i18next";
import { ConfirmModal } from "../modals/ConfirmModal";
import type { DraftField } from "./unsavedDrafts";

const FIELD_NAME_KEYS: Record<DraftField, ParseKeys> = {
  date: "lightbox.unsaved.fields.date",
  caption: "lightbox.unsaved.fields.caption",
  tags: "lightbox.unsaved.fields.tags",
  location: "lightbox.unsaved.fields.location",
};

/** The fields as the language lists things: "the date and caption". */
function listDraftFields(names: string[], language: string): string {
  try {
    return new Intl.ListFormat(language, { type: "conjunction" }).format(names);
  } catch {
    // An unknown language tag
    return new Intl.ListFormat("en", { type: "conjunction" }).format(names);
  }
}

type Props = Readonly<{
  opened: boolean;
  /** Keep editing: the drafts and the photo stay. Also Escape, the close button and a click outside. */
  onClose: () => void;
  onDiscard: () => void;
  fields: readonly DraftField[];
}>;

/**
 * Asks before the lightbox throws away an edit that is not saved yet (#2284): stepping to another
 * photo, picking a stack or similar photo, closing, or Back. Keep editing has the focus, so Enter
 * or Escape never discards. There is no Save here: each editor saves with its own button.
 */
export function DiscardDraftsModal({ opened, onClose, onDiscard, fields }: Props) {
  const { t, i18n } = useTranslation();
  const names = listDraftFields(
    fields.map(field => t(FIELD_NAME_KEYS[field])),
    i18n.language
  );
  return (
    <ConfirmModal
      opened={opened}
      onClose={onClose}
      onConfirm={onDiscard}
      title={t("lightbox.unsaved.title")}
      message={t("lightbox.unsaved.message", { fields: names })}
      confirmLabel={t("lightbox.unsaved.discard")}
      cancelLabel={t("lightbox.unsaved.keep")}
    />
  );
}
