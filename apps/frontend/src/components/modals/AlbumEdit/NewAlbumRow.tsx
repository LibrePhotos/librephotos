import { Button, TextInput, UnstyledButton } from "@mantine/core";
import { schemaResolver, useForm } from "@mantine/form";
import { IconPlus } from "@tabler/icons-react";
import React, { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import classes from "./AlbumEditModal.module.css";
import { makeNewAlbumSchema } from "./AlbumEditModal.schema";

/**
 * The picker's new album title. The server refuses a blank title (400) and the dialog closes before
 * the request settles, so an empty or taken name must not be submittable. The dialog stays mounted,
 * so it resets the form itself on every way out.
 */
export function useNewAlbumForm(existingTitles: readonly string[]) {
  const { t } = useTranslation();
  return useForm({
    initialValues: { title: "" },
    validate: schemaResolver(makeNewAlbumSchema(t, existingTitles), { sync: true }),
    validateInputOnChange: ["title"],
    transformValues: ({ title }) => ({ title: title.trim() }),
  });
}

type NewAlbumForm = ReturnType<typeof useNewAlbumForm>;

type Props = Readonly<{
  form: NewAlbumForm;
  /** Whether the row is the title field (after a click on "New album"). */
  editing: boolean;
  onEdit: (editing: boolean) => void;
  onCreate: (title: string) => void;
}>;

/**
 * The picker's first row: a dashed "+ New album" tile which, clicked, becomes the title field and
 * a primary Create in place (Google Photos). Enter creates; Escape goes back to the tile.
 */
export function NewAlbumRow({ form, editing, onEdit, onCreate }: Props) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  // Into the field the click on the tile just made
  useEffect(() => {
    if (editing) input.current?.focus();
  }, [editing]);
  const tile = (
    <span className={classes.newTile} aria-hidden>
      <IconPlus size={20} />
    </span>
  );
  if (!editing) {
    return (
      <UnstyledButton className={classes.row} onClick={() => onEdit(true)}>
        {tile}
        <span className={classes.rowTitle}>{t("modalalbum.newalbum")}</span>
      </UnstyledButton>
    );
  }
  return (
    <form
      className={classes.newRow}
      onSubmit={form.onSubmit(({ title }) => onCreate(title))}
      onKeyDown={event => {
        if (event.key !== "Escape") return;
        // Back to the tile, not out of the dialog
        event.stopPropagation();
        form.reset();
        onEdit(false);
      }}
    >
      {tile}
      <TextInput
        className={classes.newInput}
        ref={input}
        aria-label={t("modalalbum.newalbum")}
        placeholder={t("modalalbum.placeholder")}
        {...form.getInputProps("title")}
      />
      <Button type="submit" disabled={!form.isValid()}>
        {t("modalalbum.create")}
      </Button>
    </form>
  );
}
